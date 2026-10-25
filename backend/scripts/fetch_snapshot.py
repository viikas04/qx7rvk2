"""Download the pilot dataset from Elexon into backend/data/.

    cd backend
    python -m scripts.fetch_snapshot

The snapshot makes the deployed app reproducible and fast (no network calls at
request time). It only contains the two Elexon datasets the brief allows:
FUELHH (fuelType=WIND) and WINDFOR.
"""

from __future__ import annotations

import asyncio
import sys

from app import config
from app.data import clean_actuals, clean_forecasts, records_to_frame, save_raw
from app.elexon import ElexonClient


async def main() -> int:
    s = config.get_settings()
    client = ElexonClient(s.elexon_base_url, timeout_s=60)
    print("Fetching FUELHH (WIND) and WINDFOR from Elexon ...")
    actuals, forecasts = await asyncio.gather(
        client.fetch_wind_actuals(config.ACTUALS_SETTLEMENT_FROM, config.ACTUALS_SETTLEMENT_TO),
        client.fetch_wind_forecasts(config.FORECAST_PUBLISH_FROM, config.FORECAST_PUBLISH_TO),
    )
    print(f"  actual rows:   {len(actuals):>7}")
    print(f"  forecast rows: {len(forecasts):>7}")
    if not actuals or not forecasts:
        print("ERROR: Elexon returned no data - nothing written.", file=sys.stderr)
        return 1

    _, qa = clean_actuals(records_to_frame(actuals))
    _, qf = clean_forecasts(records_to_frame(forecasts))
    print(f"  cleaned actuals:   {qa}")
    print(f"  cleaned forecasts: {qf}")

    save_raw(actuals, forecasts, s.snapshot_dir)
    print(f"Saved snapshot to {s.snapshot_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
