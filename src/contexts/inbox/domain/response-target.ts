import { inboxError } from './errors'

export const DEFAULT_RESPONSE_TARGET_MINUTES = 48 * 60
export const RESPONSE_TARGET_POLICY_VERSION = 1

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

const assertPolicy = (policy: StoredPolicy): void => {
  if (
    !Number.isSafeInteger(policy.durationMinutes) ||
    policy.durationMinutes < 1 ||
    policy.durationMinutes > 720 * 60 ||
    !Number.isSafeInteger(policy.policyVersion) ||
    policy.policyVersion < 1
  ) {
    throw inboxError('invalid_input', 'Response Target policy is invalid')
  }
}

export function resolvePrivateFeedbackTargetPolicy(
  input: Readonly<{
    organizationPolicy: StoredPolicy | null
    propertyOverride: StoredPolicy | null
  }>,
): ResponseTargetPolicy {
  if (input.propertyOverride) {
    assertPolicy(input.propertyOverride)
    return { ...input.propertyOverride, policySource: 'property_override' }
  }
  if (input.organizationPolicy) {
    assertPolicy(input.organizationPolicy)
    return { ...input.organizationPolicy, policySource: 'organization_policy' }
  }
  return {
    durationMinutes: DEFAULT_RESPONSE_TARGET_MINUTES,
    policySource: 'builtin_default',
    policyVersion: RESPONSE_TARGET_POLICY_VERSION,
  }
}

export function resolveGoogleReviewTargetPolicy(
  organizationPolicy: StoredPolicy | null,
): ResponseTargetPolicy {
  if (organizationPolicy) {
    assertPolicy(organizationPolicy)
    return { ...organizationPolicy, policySource: 'organization_policy' }
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
