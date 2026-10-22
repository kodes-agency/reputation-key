// Guest context — every limiter budget a guest request spends, in one place.
//
// Two layers answer two different questions. The session layer holds one
// device: its numbers are small because one signed session takes one response.
// The network-and-Portal layer holds one public address on one Portal, and a
// hotel, a restaurant or a salon on guest Wi-Fi is one public address for every
// guest in the room. Its numbers are sized for a busy venue, not for one
// person, so a guest on shared Wi-Fi is never the one who hits them. What it
// still bounds is a client that drops its cookie and keeps posting.

import type { GuestNetworkBudgetAction } from '../application/use-cases/report-network-budget-exhausted'

export type GuestRateLimitAction = Exclude<GuestNetworkBudgetAction, 'scan'>

export type GuestRateLimitWindow = Readonly<{
  maxRequests: number
  windowSeconds: number
}>

export type GuestRateLimitBudget = Readonly<{
  session: GuestRateLimitWindow
  networkPortal: GuestRateLimitWindow
}>

const HOUR_SECONDS = 60 * 60
const DAY_SECONDS = 24 * HOUR_SECONDS

const perHour = (maxRequests: number): GuestRateLimitWindow => ({
  maxRequests,
  windowSeconds: HOUR_SECONDS,
})
const perDay = (maxRequests: number): GuestRateLimitWindow => ({
  maxRequests,
  windowSeconds: DAY_SECONDS,
})

// A shared device may legitimately serve another visitor, but rotation must not
// become an unbounded response-farming primitive. For `new_response` the
// network+Portal layer survives the new session identity.
//
// `correct` and its siblings: the aggregate enforces one successful correction
// or feedback, and a small attempt budget still permits a retry after a
// transient fault or compare-and-set race instead of making the UI's retry copy
// false.
//
// `google` and `secondary`: PostgreSQL owns exact once-per-session/destination
// semantics. This small abuse budget allows a retry after transient observation
// loss while the navigation itself stays fail-open.
const SESSION_BUDGETS = {
  submit: perHour(2),
  new_response: perDay(2),
  correct: perHour(3),
  feedback: perHour(3),
  feedback_withdraw: perHour(3),
  response_withdraw: perHour(3),
  google: perDay(3),
  secondary: perDay(3),
} as const satisfies Record<GuestRateLimitAction, GuestRateLimitWindow>

const NETWORK_PORTAL_BUDGETS = {
  submit: perHour(60),
  new_response: perDay(60),
  correct: perHour(60),
  feedback: perHour(60),
  feedback_withdraw: perHour(60),
  response_withdraw: perHour(60),
  google: perHour(300),
  secondary: perHour(300),
} as const satisfies Record<GuestRateLimitAction, GuestRateLimitWindow>

export function rateLimitBudgetFor(action: GuestRateLimitAction): GuestRateLimitBudget {
  return {
    session: SESSION_BUDGETS[action],
    networkPortal: NETWORK_PORTAL_BUDGETS[action],
  }
}

/**
 * The qualified-scan beacon. Both its Redis layer and its PostgreSQL pressure
 * twin take the network-and-Portal window, so the two never disagree.
 */
export const QUALIFIED_SCAN_BUDGET: GuestRateLimitBudget = {
  session: perHour(3),
  networkPortal: perHour(300),
}
