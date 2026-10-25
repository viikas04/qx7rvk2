"""HTTP layer: validation, caching headers, error mapping. No business logic here."""

from __future__ import annotations

import csv
import io
import logging
import time as _time
import uuid
from datetime import date, time
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

from . import config, schemas
from .analysis import Analyzer, parse_policy
from .data import DataStore, DataUnavailable
from .elexon import ElexonError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("windsight")

API = "/api/v1"
settings = config.get_settings()

app = FastAPI(
    title="WindSight API",
    version="1.0.0",
    description="Day-ahead wind forecast insight for GB (Elexon FUELHH + WINDFOR).",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_methods=["GET"],
    allow_headers=["*"],
)

# -- dependencies ------------------------------------------------------------------
_store = DataStore(settings)
_analyzer: Analyzer | None = None


def get_store() -> DataStore:
    return _store


async def get_analyzer(store: Annotated[DataStore, Depends(get_store)]) -> Analyzer:
    global _analyzer
    bundle = await store.get()
    if _analyzer is None or _analyzer.bundle is not bundle:
        _analyzer = Analyzer(bundle)
    return _analyzer


AnalyzerDep = Annotated[Analyzer, Depends(get_analyzer)]

# January 2026 is history, so responses can be cached hard at the CDN edge.
CACHE_HEADER = "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800"


# -- middleware & errors --------------------------------------------------------------
@app.middleware("http")
async def observe(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    t0 = _time.perf_counter()
    response = await call_next(request)
    ms = (_time.perf_counter() - t0) * 1000
    response.headers["x-request-id"] = rid
    response.headers["server-timing"] = f"app;dur={ms:.1f}"
    log.info(
        "%s %s -> %s in %.1fms [%s]",
        request.method,
        request.url.path,
        response.status_code,
        ms,
        rid,
    )
    return response


@app.exception_handler(DataUnavailable)
async def _data_unavailable(_: Request, exc: DataUnavailable):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(ElexonError)
async def _elexon_error(_: Request, exc: ElexonError):
    return JSONResponse(status_code=502, content={"detail": f"Upstream data provider error: {exc}"})


# -- validation helpers -------------------------------------------------------------
def _check_range(start: date, end: date) -> None:
    lo, hi = config.DELIVERY_FIRST_DAY, config.DELIVERY_LAST_DAY
    if start > end:
        raise HTTPException(422, "start must be on or before end")
    if start < lo or end > hi:
        raise HTTPException(422, f"Dates must be within {lo} and {hi} (pilot scope)")


def _parse_time(value: str) -> time:
    try:
        hh, mm = value.split(":")
        t = time(int(hh), int(mm))
    except (ValueError, TypeError):
        raise HTTPException(422, "decision_time must be HH:MM (UK local time)") from None
    if t.minute % 30:
        raise HTTPException(422, "decision_time must be on the hour or half hour")
    return t


StartQ = Annotated[date, Query(description="First delivery day (UK local)")]
EndQ = Annotated[date, Query(description="Last delivery day (UK local), inclusive")]
ModeQ = Annotated[Literal["day_ahead", "horizon"], Query()]
DecisionQ = Annotated[str, Query(pattern=r"^\d{2}:\d{2}$", description="HH:MM UK time on D-1")]
HorizonQ = Annotated[
    float, Query(ge=0.5, le=config.MAX_HORIZON_HOURS, description="Lead time in hours")
]


# -- routes -------------------------------------------------------------------------
@app.get("/api/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


@app.get(f"{API}/meta", response_model=schemas.Meta)
async def meta(analyzer: AnalyzerDep, response: Response):
    b = analyzer.bundle
    f = b.forecasts
    response.headers["cache-control"] = "public, max-age=300"
    return {
        "product": "WindSight",
        "api_version": "1",
        "data_source": b.source,
        "delivery_first_day": config.DELIVERY_FIRST_DAY.isoformat(),
        "delivery_last_day": config.DELIVERY_LAST_DAY.isoformat(),
        "default_range": {
            "start": config.DEFAULT_RANGE[0].isoformat(),
            "end": config.DEFAULT_RANGE[1].isoformat(),
        },
        "default_decision_time": config.DEFAULT_DECISION_TIME.strftime("%H:%M"),
        "max_horizon_hours": config.MAX_HORIZON_HOURS,
        "horizon_grid": list(config.HORIZON_GRID),
        "actual_periods": int(len(b.actuals)),
        "forecast_runs": int(f["publish_time"].nunique()),
        "forecast_points": int(len(f)),
        "first_publish_time": f["publish_time"].min().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "last_publish_time": f["publish_time"].max().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data_quality": b.quality,
    }


@app.get(f"{API}/analysis", response_model=schemas.AnalysisResponse)
async def analysis(
    analyzer: AnalyzerDep,
    response: Response,
    start: StartQ = config.DEFAULT_RANGE[0],
    end: EndQ = config.DEFAULT_RANGE[1],
    mode: ModeQ = "day_ahead",
    decision_time: DecisionQ = "09:00",
    horizon_hours: HorizonQ = 24.0,
):
    """Forecast-vs-actual series and accuracy statistics for a decision policy."""
    _check_range(start, end)
    policy = parse_policy(mode, _parse_time(decision_time), horizon_hours)
    response.headers["cache-control"] = CACHE_HEADER
    return await run_in_threadpool(analyzer.analysis, start, end, policy)


@app.get(f"{API}/horizon-curve", response_model=schemas.HorizonResponse)
async def horizon_curve(
    analyzer: AnalyzerDep,
    response: Response,
    start: StartQ = config.DEFAULT_RANGE[0],
    end: EndQ = config.DEFAULT_RANGE[1],
):
    """How forecast error grows with lead time (fixed-horizon policy)."""
    _check_range(start, end)
    response.headers["cache-control"] = CACHE_HEADER
    points = await run_in_threadpool(analyzer.horizon_curve, start, end)
    return {"range": {"start": start.isoformat(), "end": end.isoformat()}, "points": points}


@app.get(f"{API}/decision-day", response_model=schemas.DecisionDayResponse)
async def decision_day(
    analyzer: AnalyzerDep,
    response: Response,
    date_: Annotated[date, Query(alias="date", description="Delivery day (UK local)")],
    decision_time: DecisionQ = "09:00",
):
    """What the desk could see at decision time for one delivery day."""
    _check_range(date_, date_)
    response.headers["cache-control"] = CACHE_HEADER
    return await run_in_threadpool(analyzer.decision_day, date_, _parse_time(decision_time))


@app.get(f"{API}/analysis.csv")
async def analysis_csv(
    analyzer: AnalyzerDep,
    start: StartQ = config.DEFAULT_RANGE[0],
    end: EndQ = config.DEFAULT_RANGE[1],
    mode: ModeQ = "day_ahead",
    decision_time: DecisionQ = "09:00",
    horizon_hours: HorizonQ = 24.0,
):
    """Same data as /analysis, as a CSV the desk can open in Excel."""
    _check_range(start, end)
    policy = parse_policy(mode, _parse_time(decision_time), horizon_hours)
    result = await run_in_threadpool(analyzer.analysis, start, end, policy)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "start_time_utc",
            "actual_mw",
            "forecast_mw",
            "error_mw",
            "forecast_published_utc",
            "lead_hours",
        ]
    )
    for p in result["series"]:
        err = (
            round(p["forecast"] - p["actual"], 2)
            if p["forecast"] is not None and p["actual"] is not None
            else ""
        )
        w.writerow(
            [
                p["t"],
                p["actual"],
                p["forecast"] if p["forecast"] is not None else "",
                err,
                p["publish_time"] or "",
                p["lead_h"] if p["lead_h"] is not None else "",
            ]
        )
    name = f"windsight_{start}_{end}_{policy.describe()['mode']}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "content-disposition": f'attachment; filename="{name}"',
            "cache-control": CACHE_HEADER,
        },
    )
