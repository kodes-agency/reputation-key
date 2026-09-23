import { inboxError } from './errors'

export const DEFAULT_RESPONSE_TARGET_MINUTES = 48 * 60
const RESPONSE_TARGET_POLICY_VERSION = 1

export type ResponseTargetKind = 'google_review_response' | 'private_feedback_handling'

export type ResponseTargetPolicySource =
  'builtin_default' | 'organization_policy' | 'property_override'

export type ResponseTargetEligibility =
  'measured' | 'legacy_unknown' | 'historical_onboarding'

export type ResponseTargetResult = 'on_time' | 'late' | 'cancelled'

export type ResponseTargetPolicy = Readonly<{
  durationMinutes: number
  policySource: ResponseTargetPolicySource
  policyVersion: number
}>

type StoredPolicy = Readonly<{
  durationMinutes: number
  policyVersion: number
  /**
   * The shorter Google Review target an Organization may set for its own
   * low-rated reviews: any rating at or below `lowRatingThreshold` is
   * measured against `lowRatingDurationMinutes` instead. Both null (the
   * default, and every row written before this existed) means one clock for
   * every review, exactly as before.
   *
   * This is where a rating may change how soon somebody is prompted. The
   * rating stays in Inbox, which already reads it for list filters; Feed
   * neither stores nor reads a rating class (ADR 0046 r.8).
   */
  lowRatingThreshold?: number | null
  lowRatingDurationMinutes?: number | null
}>

export type ResponseTargetReminderKind = 'halfway' | 'target_passed'

export type ResponseTargetSnapshot = Readonly<{
  targetKind: ResponseTargetKind
  eligibility: 'measured'
  durationMinutes: number
  policySource: ResponseTargetPolicySource
  policyVersion: number
  startAt: Date
  dueAt: Date
  reminders: readonly [
    Readonly<{ kind: 'halfway'; scheduledFor: Date }>,
    Readonly<{ kind: 'target_passed'; scheduledFor: Date }>,
  ]
}>

const invalidPolicy = () =>
  inboxError('invalid_input', 'Response Target policy is invalid')

/**
 * The low-rating pair is all-or-nothing: a threshold with no duration would
 * describe reviews it cannot measure, and a duration with no threshold would
 * name no reviews. It must also be SHORTER than the ordinary target — the
 * point is an earlier prompt, and a longer one would quietly give a one-star
 * review more time than a five-star one.
 */
const assertLowRatingPolicy = (policy: StoredPolicy): void => {
  const threshold = policy.lowRatingThreshold ?? null
  const duration = policy.lowRatingDurationMinutes ?? null
  if (threshold === null && duration === null) return
  if (
    threshold === null ||
    duration === null ||
    !Number.isSafeInteger(threshold) ||
    threshold < 1 ||
    threshold > 5 ||
    !Number.isSafeInteger(duration) ||
    duration < 1 ||
    duration > policy.durationMinutes
  ) {
    throw invalidPolicy()
  }
}

const assertPolicy = (policy: StoredPolicy): void => {
  if (
    !Number.isSafeInteger(policy.durationMinutes) ||
    policy.durationMinutes < 1 ||
    policy.durationMinutes > 720 * 60 ||
    !Number.isSafeInteger(policy.policyVersion) ||
    policy.policyVersion < 1
  ) {
    throw invalidPolicy()
  }
  assertLowRatingPolicy(policy)
}

/**
 * Private feedback has one clock per scope. The low-rating pair is a Google
 * Review policy only — the database refuses it on a private-feedback row —
 * so nothing here reads it, and the resolved policy is built field by field
 * rather than spread, so nothing can leak into the stored snapshot either.
 */
export function resolvePrivateFeedbackTargetPolicy(
  input: Readonly<{
    organizationPolicy: StoredPolicy | null
    propertyOverride: StoredPolicy | null
  }>,
): ResponseTargetPolicy {
  if (input.propertyOverride) {
    assertPolicy(input.propertyOverride)
    return {
      durationMinutes: input.propertyOverride.durationMinutes,
      policySource: 'property_override',
      policyVersion: input.propertyOverride.policyVersion,
    }
  }
  if (input.organizationPolicy) {
    assertPolicy(input.organizationPolicy)
    return {
      durationMinutes: input.organizationPolicy.durationMinutes,
      policySource: 'organization_policy',
      policyVersion: input.organizationPolicy.policyVersion,
    }
  }
  return {
    durationMinutes: DEFAULT_RESPONSE_TARGET_MINUTES,
    policySource: 'builtin_default',
    policyVersion: RESPONSE_TARGET_POLICY_VERSION,
  }
}

/**
 * `rating` is the guest's star rating on the Material Review Revision this
 * cycle measures, attested by Review with the rest of the target provenance.
 * Null when the revision carries none, which resolves to the ordinary target.
 */
export function resolveGoogleReviewTargetPolicy(
  organizationPolicy: StoredPolicy | null,
  rating: number | null = null,
): ResponseTargetPolicy {
  if (organizationPolicy) {
    assertPolicy(organizationPolicy)
    const threshold = organizationPolicy.lowRatingThreshold ?? null
    const lowRatingDuration = organizationPolicy.lowRatingDurationMinutes ?? null
    const durationMinutes =
      threshold !== null &&
      lowRatingDuration !== null &&
      rating !== null &&
      rating <= threshold
        ? lowRatingDuration
        : organizationPolicy.durationMinutes
    return {
      durationMinutes,
      policySource: 'organization_policy',
      policyVersion: organizationPolicy.policyVersion,
    }
  }
  return {
    durationMinutes: DEFAULT_RESPONSE_TARGET_MINUTES,
    policySource: 'builtin_default',
    policyVersion: RESPONSE_TARGET_POLICY_VERSION,
  }
}

const addMinutes = (instant: Date, minutes: number): Date => {
  const timestamp = instant.getTime() + minutes * 60_000
  if (!Number.isFinite(instant.getTime()) || !Number.isFinite(timestamp)) {
    throw inboxError('invalid_input', 'Response Target timestamp is invalid')
  }
  return new Date(timestamp)
}

export function buildResponseTargetSnapshot(
  input: Readonly<{
    targetKind: ResponseTargetKind
    policy: ResponseTargetPolicy
    startAt: Date
  }>,
): ResponseTargetSnapshot {
  assertPolicy(input.policy)
  const dueAt = addMinutes(input.startAt, input.policy.durationMinutes)
  const halfwayAt = addMinutes(input.startAt, input.policy.durationMinutes / 2)
  return {
    targetKind: input.targetKind,
    eligibility: 'measured',
    ...input.policy,
    startAt: input.startAt,
    dueAt,
    reminders: [
      { kind: 'halfway', scheduledFor: halfwayAt },
      { kind: 'target_passed', scheduledFor: dueAt },
    ],
  }
}

/**
 * A halfway reminder gets a slot only while it is still ahead of the moment
 * its target is recorded: one already due then (a Review first observed long
 * after Google published it) would prompt about a halfway point nobody could
 * have acted on. The target-passed slot always stays. A target already
 * overdue when it is recorded is still unanswered work, so it prompts once,
 * at the next release.
 */
export function schedulableReminders(
  snapshot: ResponseTargetSnapshot,
  recordedAt: Date,
): ReadonlyArray<ResponseTargetSnapshot['reminders'][number]> {
  if (!Number.isFinite(recordedAt.getTime())) {
    throw inboxError('invalid_input', 'Response Target timestamp is invalid')
  }
  return snapshot.reminders.filter(
    (reminder) =>
      reminder.kind === 'target_passed' ||
      reminder.scheduledFor.getTime() > recordedAt.getTime(),
  )
}

/**
 * Once the target itself has passed, a halfway reminder still waiting for
 * release is superseded: the target-passed reminder says all it would, so
 * releasing both would only double the prompt.
 */
export function isSupersededReminder(
  reminderKind: ResponseTargetReminderKind,
  dueAt: Date,
  now: Date,
): boolean {
  return reminderKind === 'halfway' && dueAt.getTime() <= now.getTime()
}

type EvaluatedTarget = Readonly<{
  eligibility: ResponseTargetEligibility
  startAt: Date | null
  dueAt: Date | null
  completionAt: Date | null
  result: ResponseTargetResult | null
}>

export type ResponseTargetEvaluation = Readonly<{
  state: 'active' | 'completed' | 'cancelled' | 'excluded'
  overdue: boolean
  elapsedMinutes: number | null
}>

export function evaluateResponseTarget(
  target: EvaluatedTarget,
  now: Date,
): ResponseTargetEvaluation {
  if (
    target.eligibility !== 'measured' ||
    target.startAt === null ||
    target.dueAt === null
  ) {
    return { state: 'excluded', overdue: false, elapsedMinutes: null }
  }
  if (target.result === 'cancelled') {
    return { state: 'cancelled', overdue: false, elapsedMinutes: null }
  }
  const effectiveEnd = target.completionAt ?? now
  const elapsedMinutes = Math.max(
    0,
    Math.floor((effectiveEnd.getTime() - target.startAt.getTime()) / 60_000),
  )
  if (target.completionAt !== null) {
    return { state: 'completed', overdue: target.result === 'late', elapsedMinutes }
  }
  return {
    state: 'active',
    overdue: now.getTime() >= target.dueAt.getTime(),
    elapsedMinutes,
  }
}

export function classifyResponseTargetCompletion(
  dueAt: Date,
  completionAt: Date,
): Extract<ResponseTargetResult, 'on_time' | 'late'> {
  return completionAt.getTime() <= dueAt.getTime() ? 'on_time' : 'late'
}
