// Property Google rating goal — how far a forecast allows its inputs to drift.
//
// There is no deadline: a goal says when it is expected, as durations from
// today (rating-goal-arrival.ts, round 5). The likely range allows for drift in
// both inputs: the average new reviews bring 0.1★ better or worse, and the pace
// 10% faster or slower. Calendar months were retired with round 5 (PLAN-D E3).

/** The forecast allows the average new reviews bring to drift this far either way (0.1★). */
export const FORECAST_MIX_DRIFT_THOUSANDTHS = 100
/** The forecast allows the pace to drift this far either way. */
export const FORECAST_PACE_DRIFT_PERCENT = 10
