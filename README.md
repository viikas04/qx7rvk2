# WindSight

**Day-ahead wind forecast insight for a GB electricity buyer.**

A UK utility buys its day-ahead power on the day before delivery. Wind covers part of demand, so how much to buy depends on the wind forecast. WindSight answers the desk's two questions for purchase decisions made in **January 2026**:

1. **What did the forecast say when we had to decide?** For any delivery day and decision time, it shows the newest forecast that had been published by then, against what actually happened.
2. **How much can we trust it?** It measures forecast error over the period and turns it into numbers the desk can act on, such as how much backup to hold to be covered 9 times out of 10.

**Live app:** <!-- paste your Vercel URL here --> `https://<your-app>.vercel.app`

---

## What's in the app

| View | What it answers |
| --- | --- |
| **Summary** | The pilot's key findings for the client in plain statements, each linked to the evidence. |
| **Decision day** | Pick a delivery day and decision time (UK). See the forecast the desk could act on, older forecasts, and (optionally) forecasts published after the decision, against actual generation. A canvas-drawn grid shows how every forecast run for that day evolved and how wrong each one was. |
| **Forecast accuracy** | Interactive backup planner (pick a cover level, see the MW needed and how often the desk would still be short, drawn on the chart); typical miss (MAE), RMSE, bias, coverage; forecast vs actual over the whole period (zoomable); misses by forecast wind level; error vs lead time; error distribution; error by hour of day; error by day. CSV export. |
| **How it works** | The method in plain English, for the client. |

Every setting lives in the URL, so any view can be shared as a link.

## The key rule: never use a forecast from the future

WINDFOR publishes a new forecast run regularly, each with a `publishTime`. For every half-hour settlement period, WindSight uses the **most recent forecast published at or before the decision cut-off**. A run published even a minute later is never used, because the desk could not have seen it. This is implemented with an as-of join (`pandas.merge_asof`, `direction="backward"`) and covered by tests.

Two decision rules are supported:

- **Day before (default):** one cut-off per delivery day, at a chosen UK time on D-1 (default 09:00, adjustable to match the desk's own deadline). DST-safe.
- **Fixed lead time:** cut-off = period start − N hours (0.5–48 h). Used to show how error grows with lead time.

**Scope.** Decisions made in January 2026 cover delivery days 2 January to 1 February 2026 (a decision on 31 Jan is for 1 Feb). Data for 1 January is also loaded for the fixed-lead view. Only forecasts 0–48 h ahead are considered.

**Data used.** Only the two Elexon datasets in the brief, at national level:
- Actuals: [`FUELHH`](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream) with `fuelType = WIND` (`startTime`, `generation`)
- Forecasts: [`WINDFOR`](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream) (`startTime`, `publishTime`, `generation`)

## How to start the application

### Option 1: Docker (recommended)

Needs [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
docker compose up --build
```

Open <http://localhost:8080>. The API docs are at <http://localhost:8080/api/docs>.

### Option 2: run the two parts directly

Needs Python 3.12+ and Node 22+.

```bash
# terminal 1 - backend
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# terminal 2 - frontend
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

### Data: snapshot or live

On first use the backend fetches the pilot data from Elexon and caches it. To bundle a fixed copy with the app (faster and reproducible, and what the deployed app uses), run once:

```bash
cd backend
python -m scripts.fetch_snapshot      # writes backend/data/*.csv.gz
```

`DATA_MODE` controls this: `auto` (default: snapshot if present, otherwise live), `snapshot`, or `live`.

### Tests and checks

```bash
cd backend && pytest && ruff check .        # 39 tests: data cleaning, forecast selection, metrics, API, Elexon client
cd frontend && npm test && npm run lint     # formatting, dates, backup quantile maths
```

GitHub Actions runs the same checks, plus a Docker build, on every push.

## Files and directories

```
.
├── backend/                     Python API (FastAPI)
│   ├── app/
│   │   ├── main.py              HTTP layer: routes, validation, caching headers, error handling
│   │   ├── analysis.py          Use cases: analysis, horizon curve, decision day (memoised)
│   │   ├── forecast.py          Decision policies + forecast selection (no look-ahead)
│   │   ├── metrics.py           Accuracy statistics (MAE, RMSE, bias, P90 backup, histograms...)
│   │   ├── data.py              Loading, cleaning and caching of the two datasets
│   │   ├── elexon.py            Async Elexon client: chunked requests, retries, backoff
│   │   ├── schemas.py           Typed response models (drive the OpenAPI docs)
│   │   └── config.py            Pilot scope and settings in one place
│   ├── scripts/fetch_snapshot.py  Downloads the pilot data into backend/data/
│   ├── data/                    Bundled snapshot of the Elexon data (csv.gz)
│   ├── tests/                   pytest suite (synthetic data, no network needed)
│   ├── Dockerfile
│   └── requirements*.txt
├── frontend/                    React + TypeScript (Vite)
│   ├── src/
│   │   ├── App.tsx              Shell, navigation, URL state
│   │   ├── views/               Summary, DecisionDay, Accuracy, Method screens
│   │   ├── components/ui.tsx    Shared UI pieces (stats, panels, pickers, errors)
│   │   ├── api/                 Typed API client and React Query hooks
│   │   └── lib/                 Formatting (UK time), backup maths and URL-state helpers, with tests
│   ├── Dockerfile, nginx.conf   Production image: static site + /api proxy
│   └── vite.config.ts
├── api/index.py                 Vercel serverless entry point for the backend
├── vercel.json                  Vercel build and routing
├── docker-compose.yml           Runs backend + frontend locally
├── docs/ARCHITECTURE.md         Design notes for reviewers
└── .github/workflows/ci.yml     Lint, test, build, Docker build
```

## Deployment

Deployed on Vercel as one project: the React build is served as static files and `api/index.py` runs the FastAPI app as a Python serverless function. Responses carry long CDN cache headers because January 2026 data no longer changes. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Use of AI tools

I used an AI assistant (Claude, by Anthropic) while building this project, for help with code, tests, and documentation. I reviewed the design decisions, ran and checked the application, and can explain how every part works.
