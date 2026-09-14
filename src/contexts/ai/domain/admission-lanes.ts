// AI admission lanes — the one budget table for provider-bound AI work.
//
// Every provider call is admitted exactly once, before its execution attempt is
// claimed, against three scopes (global, organization, property) in one of two
// lanes. Interactive work (a manager waiting on a reply draft, or an analysis
// requested for the review on screen) and background work (review analysis
// backlogs) have independent buckets in every scope, so a property's backlog can
// never consume the capacity a manager's draft needs. ADR 0057 records these
// numbers; change them here and in the ADR together.

export const AI_ADMISSION_LANES = ['interactive', 'background'] as const
export type AiAdmissionLane = (typeof AI_ADMISSION_LANES)[number]

export const AI_ADMISSION_SCOPES = ['global', 'organization', 'property'] as const
export type AiAdmissionScope = (typeof AI_ADMISSION_SCOPES)[number]

type LaneBudget = Readonly<Record<AiAdmissionLane, number>>
type ScopeBudget = Readonly<Record<AiAdmissionScope, LaneBudget>>

/** Sliding window over which admissions per scope and lane are counted. */
export const AI_ADMISSION_RATE_WINDOW_MILLIS = 60_000

/**
 * How long an admission holds its in-flight slot when its owner never releases
 * it. It outlives the provider request deadline of every admitted profile
 * (70 s for analysis and reply drafting) plus the result writes that follow, so
 * a slow call is not counted as free capacity while it is still running.
 */
export const AI_ADMISSION_LEASE_MILLIS = 90_000

/** Admissions per sliding minute. */
export const AI_ADMISSION_RATE_PER_MINUTE: ScopeBudget = Object.freeze({
  global: Object.freeze({ interactive: 8, background: 12 }),
  organization: Object.freeze({ interactive: 4, background: 6 }),
  property: Object.freeze({ interactive: 3, background: 3 }),
})

/** Concurrent provider calls. */
export const AI_ADMISSION_IN_FLIGHT: ScopeBudget = Object.freeze({
  global: Object.freeze({ interactive: 8, background: 12 }),
  organization: Object.freeze({ interactive: 4, background: 4 }),
  property: Object.freeze({ interactive: 2, background: 2 }),
})

/**
 * Slots an on-demand analysis must leave free in the interactive lane, so the
 * reviews a manager clicks through can never exhaust the lane their reply
 * drafts use.
 */
export const AI_ON_DEMAND_ANALYSIS_INTERACTIVE_HEADROOM = 1

export function isAiAdmissionLane(value: unknown): value is AiAdmissionLane {
  return (AI_ADMISSION_LANES as readonly unknown[]).includes(value)
}
