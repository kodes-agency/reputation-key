// AI admission lanes — the one budget table for provider-bound AI work.
//
// Every provider call is admitted exactly once, before its execution attempt is
// claimed, against three scopes (global, organization, property) in one of two
// lanes. Interactive work (a manager waiting on a reply draft, or an analysis
// requested for the review on screen) and background work (review analysis
// backlogs) have independent buckets in every scope, so a property's backlog can
// never consume the capacity a manager's draft needs. ADR 0058 records these
// numbers; change them here and in the ADR together.

export const AI_ADMISSION_LANES = ['interactive', 'background'] as const
export type AiAdmissionLane = (typeof AI_ADMISSION_LANES)[number]

export const AI_ADMISSION_SCOPES = ['global', 'organization', 'property'] as const
export type AiAdmissionScope = (typeof AI_ADMISSION_SCOPES)[number]

type LaneBudget = Readonly<Record<AiAdmissionLane, number>>
type ScopeBudget = Readonly<Record<AiAdmissionScope, LaneBudget>>

/** Sliding window over which admissions per scope and lane are counted. */
export const AI_ADMISSION_RATE_WINDOW_MILLIS = 60_000

/** Background drafts share analysis capacity, so their own sliding-minute caps are lower. */
export const AI_BACKGROUND_DRAFT_RATE_PER_MINUTE = Object.freeze({
  actor: 6,
  organization: 30,
})

/**
 * How long an admission holds its in-flight slot when its owner never releases
 * it. It outlives the provider request deadline of every admitted profile
 * (70 s for analysis and reply drafting) plus the result writes that follow, so
 * a slow call is not counted as free capacity while it is still running.
 */
export const AI_ADMISSION_LEASE_MILLIS = 90_000

/**
 * The provider account's per-minute limits for the pinned model (`gpt-6-luna`),
 * read on 2026-10-30 from the `x-ratelimit-limit-requests` and
 * `x-ratelimit-limit-tokens` headers on the beta key. The provider counts a
 * request's output ceiling against the token limit before it answers.
 */
export const AI_PROVIDER_ACCOUNT_LIMITS_PER_MINUTE = Object.freeze({
  requests: 5_000,
  tokens: 2_000_000,
})

/**
 * Admissions per sliding minute. The background lane is sized against the
 * provider account, not against drafts, which have their own lane: a v3
 * analysis counts about 7,900 tokens (about 3,800 of input plus the
 * 4,096-token output ceiling), and both global lanes together stay under half
 * of either account limit. Half of the token limit is 126 analyses a minute, so
 * the global background lane admits 125. One property may use its
 * organization's whole background budget, so a single import runs as fast as
 * the account allows.
 */
export const AI_ADMISSION_RATE_PER_MINUTE: ScopeBudget = Object.freeze({
  global: Object.freeze({ interactive: 8, background: 125 }),
  organization: Object.freeze({ interactive: 4, background: 120 }),
  property: Object.freeze({ interactive: 3, background: 120 }),
})

/**
 * Concurrent provider calls. For history these, not the rates, set the pace: an
 * analysis takes about 5 s (p50 4.8 s, p90 9.3 s end to end on the beta,
 * 2026-10-30), so 8 at a time ran 45 to 60 a minute against a rate budget of
 * 120. A drain runs as many at once as an organization may have in flight
 * (`AI_BACKLOG_DRAIN_CONCURRENCY`); the global 24 leaves the rest of the lane to
 * reviews analysed on delivery.
 */
export const AI_ADMISSION_IN_FLIGHT: ScopeBudget = Object.freeze({
  global: Object.freeze({ interactive: 8, background: 24 }),
  organization: Object.freeze({ interactive: 4, background: 16 }),
  property: Object.freeze({ interactive: 2, background: 16 }),
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
