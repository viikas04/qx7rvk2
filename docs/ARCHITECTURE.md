# Architecture and design notes

## Overview

```
 Browser (React + React Query)
      │  GET /api/v1/...   (JSON, gzip, CDN-cacheable)
      ▼
 FastAPI  ── main.py        HTTP: validation, errors, cache headers, request timing
      │
      ├── analysis.py       use cases, memoised per dataset (lru_cache)
      ├── forecast.py       decision policies + as-of forecast selection
      ├── metrics.py        accuracy statistics
      └── data.py           load once → clean → in-memory DataFrames
              │
              ├── backend/data/*.csv.gz   bundled snapshot (preferred)
              ├── /tmp cache              written after a live fetch
              └── elexon.py ──► Elexon BMRS (FUELHH, WINDFOR)
```

The layers only depend downwards. `forecast.py` and `metrics.py` are pure functions on DataFrames, so the core logic is tested without HTTP or network.

## Key decisions

**1. No look-ahead.** The value of the product depends on showing the forecast the desk *actually had*. Selection is an as-of join: for each period, the latest row with `publish_time <= cutoff` for the same `start_time`. Tests assert `publish_time <= cutoff` for every selected value and check boundary cases (published exactly at the cut-off is allowed; one interval later is not).

**2. Decision policies as small objects.** `DayAheadPolicy` and `HorizonPolicy` each turn period start times into cut-offs. Adding a new rule (for example, a different deadline for weekends) means adding one class, with no change to selection or metrics. The day-ahead cut-off is built in UK wall-clock time and then converted to UTC, so "09:00 the day before" stays correct across clock changes (tested on 29 March 2026).

**3. Snapshot first, live as fallback.** January 2026 is history. Bundling the data makes the deployed app fast, reproducible and independent of Elexon's uptime. The same code path can still fetch live (`DATA_MODE=live`), with chunked requests, bounded concurrency, and retry with exponential backoff on 429/5xx only.

**4. Cleaning rules are explicit and reported.** Re-published actuals: keep the latest. Duplicate forecast rows: drop. Forecast points outside 0–48 h ahead: drop. Hourly forecast runs: fill only the single half hour between two points by linear interpolation, and flag it. Counts of everything dropped or filled are returned in `/api/v1/meta` → `data_quality`.

**5. Metrics a buyer can use.** Besides MAE/RMSE/bias, the P90 and P95 of `forecast − actual` give "how much backup covers the shortfall in 90% / 95% of half hours". WAPE is used instead of MAPE because wind output can be near zero, which makes percentage errors explode.

**6. API that ages well.** Versioned under `/api/v1`, typed response models (OpenAPI at `/api/docs`), consistent units (MW, MWh, hours, UTC ISO timestamps), clear 422 messages for invalid input, 502/503 for upstream or data problems.

**7. Performance.** Data loads once per process (about 1 s). Each analysis runs in tens of milliseconds and is memoised. Responses are gzip-compressed and carry `s-maxage` so the Vercel CDN serves repeats. CPU work runs in a thread pool so the event loop is never blocked.

**8. Frontend state.** Server state lives in React Query (cached forever per query, since the data is immutable, with the previous result kept on screen while a new one loads). View state lives in the URL, so every screen is a shareable link. Heavy views are lazy-loaded and the charting library is split into its own chunk. The backup planner recomputes quantiles in the browser from the sorted errors (memoised), so the slider responds instantly without a server round trip.

**9. Custom visualisation.** The forecast-evolution grid (`components/ForecastEvolution.tsx`) is drawn on `<canvas>` rather than with the chart library: rows are forecast runs, columns are settlement periods, colour is the run's error. It scales for high-DPI screens, redraws on resize (ResizeObserver) and on light/dark change, reads colours from the CSS design tokens, and hit-tests the mouse position for its tooltip. Colour maths lives in `lib/heat.ts` and is unit-tested.

## Observability

Every request is logged with method, path, status and duration, and gets an `x-request-id` and `server-timing` header. Data loading logs its source, row counts and timing.

## Testing

| Area | What is checked |
| --- | --- |
| `test_forecast.py` | no future data at any horizon, latest eligible run chosen, missing → NaN, exact cut-off, DST-safe day-ahead cut-offs |
| `test_data.py` | revisions, invalid rows, horizon filter, interpolation limits |
| `test_metrics.py` | known-value MAE/RMSE/bias/WAPE, coverage, reserve never negative, empty input, histogram totals, error by forecast level |
| `test_api.py` | every endpoint, validation errors, cache headers, CSV export, hiding forecast runs that did not change |
| `test_elexon.py` | request parameters, WIND filter, retry on 503, no retry on 400 |
| `format.test.ts` | UK time incl. summer time, day arithmetic, formatting |
| `stats.test.ts` | backup quantile matches numpy, shortfall counting, never negative |

## Possible next steps

- Add more data sources the client may care about (solar, demand) behind the same policy/metric layer.
- Probabilistic view: conditional error bands by forecast level or season.
- Scheduled snapshot refresh for a live (not pilot) deployment.
