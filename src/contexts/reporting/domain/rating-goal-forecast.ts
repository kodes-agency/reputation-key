// Arrival ranges vary quality by ±0.1★ and pace by ±10%. Durations run from
// today through the shared arrival rule; a goal has no deadline.

/** The forecast allows the average new reviews bring to drift this far either way (0.1★). */
export const FORECAST_MIX_DRIFT_THOUSANDTHS = 100
/** The forecast allows the pace to drift this far either way. */
export const FORECAST_PACE_DRIFT_PERCENT = 10
