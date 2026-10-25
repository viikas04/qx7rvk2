import type { Meta } from "../api/types";
import { longDay, ukDateTime } from "../lib/format";

export default function Method({ meta }: { meta: Meta }) {
  return (
    <div className="view prose">
      <h2>How WindSight works</h2>
      <p>
        The desk buys power for each delivery day on the day before. Wind covers part of demand, so
        the amount left to buy depends on the wind forecast. WindSight answers two questions for the
        pilot period: what did the forecast say when we had to decide, and how far can we trust it?
      </p>

      <h3>Data</h3>
      <p>
        Two public Elexon datasets, national level, nothing else. Actual wind generation comes from
        FUELHH (fuel type WIND), one value per half-hour settlement period. Forecasts come from
        WINDFOR: each forecast run has a publish time and predicts generation for the hours ahead.
      </p>
      <p>
        This deployment holds {meta.actual_periods.toLocaleString("en-GB")} half hours of actuals
        and {meta.forecast_runs.toLocaleString("en-GB")} forecast runs
        {meta.first_publish_time && meta.last_publish_time && (
          <> published between {ukDateTime(meta.first_publish_time)} and {ukDateTime(meta.last_publish_time)}</>
        )}
        , covering deliveries from {longDay(meta.delivery_first_day)} to {longDay(meta.delivery_last_day)}.
      </p>

      <h3>Which forecast counts</h3>
      <p>
        For each half hour we take the most recent forecast that was already published at the
        decision moment. A forecast published even a minute later is never used, because the desk
        could not have seen it. Two decision rules are available:
      </p>
      <ul>
        <li>
          <strong>The day before:</strong> one decision time on the previous day (09:00 UK time by
          default) for the whole delivery day. Change it to match your own deadline.
        </li>
        <li>
          <strong>A fixed time ahead:</strong> each half hour uses the forecast published at least a
          chosen number of hours before it. This shows how quickly accuracy falls away with lead time.
        </li>
      </ul>
      <p>
        The pilot covers purchase decisions made in January 2026, which means deliveries from
        2 January to 1 February. Only forecasts up to 48 hours ahead are considered.
      </p>

      <h3>How accuracy is measured</h3>
      <p>Error is forecast minus actual, in MW, for every half hour where both exist.</p>
      <ul>
        <li><strong>Typical miss (MAE):</strong> the average size of the error.</li>
        <li><strong>RMSE:</strong> like MAE but punishes big misses more.</li>
        <li><strong>Bias:</strong> the average signed error. Positive means the forecast runs high and the desk tends to be short.</li>
        <li>
          <strong>Backup needed (P90 / P95):</strong> the shortfall that is not exceeded in 90% or
          95% of half hours. Holding that much extra covers the desk 9 or 19 times in 20 respectively.
        </li>
        <li><strong>Coverage:</strong> the share of half hours that had an eligible forecast at all.</li>
      </ul>

      <h3>Data handling</h3>
      <ul>
        <li>If Elexon re-published an actual value, the latest publication is used.</li>
        <li>Duplicate forecast rows and points outside 0–48 hours ahead are dropped.</li>
        <li>
          If a forecast run is hourly, the half hour in between is filled by straight-line
          interpolation and marked as such. Larger gaps are never filled.
        </li>
        <li>All times are stored in UTC and shown in UK local time.</li>
      </ul>
    </div>
  );
}
