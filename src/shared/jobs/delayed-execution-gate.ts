// BQC-3.2 — delayed execution gate.
//
// The single decision point for delayed/system execution. Workers, schedule
// firings, in-process bus consumers, and the durable outbox dispatcher all
// authorize here against the BQC-2.5 delayed/system execution policy
// (src/shared/auth/system-execution-policy.ts) — decisions are computed from
// CURRENT policy at execution time, so a stale allow in a queued job never
// overrides a current deny.
//
// The gate builds the content-free DelayedDecisionRequest from the
// entry-point catalogue row (action/scope) plus the job/event envelope
// (org/property scope, optional policy context stamped at enqueue). Job
// handlers never re-check capabilities themselves — direct in-handler checks
// were removed in BQC-3.2 (see architecture/delayed-policy-delegation.test).
//
// Outcome mapping (phase BQC-3 §3.2 typed runtime outcomes):
//   allow                        → allow — invoke the work
//   deny 'policy_unavailable'    → deny_retry — the call site THROWS so BullMQ
//                                  retries: protected work must never run
//                                  without a decision, and an unavailable
//                                  policy is transient, not a revocation
//   every other deny             → deny_terminal — typed terminal state, no
//                                  side effect, no retry

import type { Job } from 'bullmq'
import {
  ENTRY_POINT_CATALOGUE,
  type EntryPointRow,
  type SystemAction,
} from '#/shared/governance/entry-point-catalogue'
import {
  getDelayedExecutionPolicy,
  type DelayedDecision,
} from '#/shared/auth/system-execution-policy'
import type { Capability } from '#/shared/auth/beta-capabilities'
import {
  EXECUTION_POLICY_VERSION,
  isConsentSelectorBoundToScope,
  type ConsentSelector,
  type MerchantAiConsentFence,
} from '#/shared/auth/execution-policy'
import type { ConsumerEvent } from '#/shared/outbox/envelope'
import { getLogger } from '#/shared/observability/logger'
import { GateDenyRetryError, JobTimeoutError, UnknownJobError } from './errors'
import { jobTimeoutMs } from './job-policy'
import type { JobRegistry } from './registry'

/**
 * Sentinel organization for tenant_cross/none-scope work that has no org at
 * dispatch (BQC-2.5 fixture pattern: the decision still needs a truthy org to
 * pass scope validation; capability/suspension checks then apply to the
 * sentinel, which is never allowlisted or suspended).
 */
export const TENANT_CROSS_ORG = 'tenant-cross'

/**
 * Content-free, producer-stamped execution metadata for controlled jobs.
 * Scope remains duplicated in domain payload fields so handlers do not need
 * to unwrap policy machinery; the gate owns this metadata.
 */
export type JobExecutionEnvelope = Readonly<{
  organizationId: string
  propertyId?: string
  capability: Capability | 'none'
  policyVersionAtEnqueue: string
  initiator: Readonly<{ kind: 'user' | 'system'; id: string }>
  consent?: ConsentSelector
  correlationId?: string
}>

export type JobEnqueueAttribution = Readonly<
  Partial<Pick<JobExecutionEnvelope, 'initiator' | 'correlationId' | 'consent'>>
>

export function createJobExecutionEnvelope(
  input: Omit<JobExecutionEnvelope, 'policyVersionAtEnqueue'>,
): JobExecutionEnvelope {
  if (input.organizationId.length === 0) {
    throw new Error('job execution envelope requires organizationId')
  }
  if (input.propertyId !== undefined && input.propertyId.length === 0) {
    throw new Error('job execution envelope propertyId cannot be empty')
  }
  if (input.initiator.id.length === 0) {
    throw new Error('job execution envelope requires a named initiator')
  }
  if (input.consent !== undefined) {
    const consent = envelopeConsent({ consent: input.consent })
    const scopeMatches =
      consent !== undefined &&
      isConsentSelectorBoundToScope(consent, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        userId: input.initiator.kind === 'user' ? input.initiator.id : undefined,
      })
    if (!scopeMatches) {
      throw new Error('job execution envelope consent selector does not match scope')
    }
  }
  return {
    organizationId: input.organizationId,
    capability: input.capability,
    initiator: input.initiator,
    policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
    ...(input.propertyId === undefined ? {} : { propertyId: input.propertyId }),
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    ...(input.consent === undefined ? {} : { consent: input.consent }),
  }
}

export type GateOutcome =
  | Readonly<{ kind: 'allow'; decision: DelayedDecision }>
  | Readonly<{ kind: 'deny_terminal'; decision: DelayedDecision }>
  | Readonly<{ kind: 'deny_retry'; decision: DelayedDecision }>

/** Resolves dispatch-time scope not carried in the payload (e.g. reply → property). */
export type ScopeResolver = (
  jobName: string,
  data: unknown,
) => Promise<string | undefined>

// ── Catalogue maps (derived at module load) ──────────────────────────

const DELAYED_ROWS = ENTRY_POINT_CATALOGUE.filter(
  (r) => r.kind === 'job' || r.kind === 'consumer' || r.kind === 'schedule',
)
const JOB_ROW_BY_NAME = new Map(
  DELAYED_ROWS.filter((r) => r.kind === 'job').map((r) => [r.name, r]),
)
// Schedule rows are named '<jobName>-recurring'; the fired BullMQ job carries
// the bare job name, so key the map by the stripped name.
const SCHEDULE_ROW_BY_JOB_NAME = new Map(
  DELAYED_ROWS.filter((r) => r.kind === 'schedule').map((r) => [
    r.name.replace(/-recurring$/, ''),
    r,
  ]),
)
const CONSUMER_ROW_BY_NAME = new Map(
  DELAYED_ROWS.filter((r) => r.kind === 'consumer').map((r) => [r.name, r]),
)

// ── Request building ─────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function envelopeCapability(
  data: Record<string, unknown>,
): Capability | 'none' | undefined {
  const capability = data.capability
  return typeof capability === 'string' ? (capability as Capability | 'none') : undefined
}

function envelopeInitiator(
  data: Record<string, unknown>,
): JobExecutionEnvelope['initiator'] | undefined {
  const initiator = data.initiator
  if (
    !isRecord(initiator) ||
    (initiator.kind !== 'user' && initiator.kind !== 'system') ||
    typeof initiator.id !== 'string' ||
    initiator.id.length === 0
  ) {
    return undefined
  }
  return { kind: initiator.kind, id: initiator.id }
}
function envelopeFence(value: unknown): MerchantAiConsentFence | null | undefined {
  if (value === undefined) return undefined
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 6 ||
    typeof value.authorizationLineageId !== 'string' ||
    typeof value.capabilityEpoch !== 'number' ||
    !Number.isSafeInteger(value.capabilityEpoch) ||
    value.capabilityEpoch < 1 ||
    typeof value.authorizedSourceEpoch !== 'number' ||
    !Number.isSafeInteger(value.authorizedSourceEpoch) ||
    // 0-based source epoch (drizzle/0060), unlike capabilityEpoch/stateVersion.
    value.authorizedSourceEpoch < 0 ||
    typeof value.stateVersion !== 'number' ||
    !Number.isSafeInteger(value.stateVersion) ||
    value.stateVersion < 1 ||
    typeof value.noticeDigest !== 'string' ||
    typeof value.runtimeProfileVersion !== 'string'
  ) {
    return null
  }
  return {
    authorizationLineageId: value.authorizationLineageId,
    capabilityEpoch: value.capabilityEpoch,
    authorizedSourceEpoch: value.authorizedSourceEpoch,
    stateVersion: value.stateVersion,
    noticeDigest: value.noticeDigest,
    runtimeProfileVersion: value.runtimeProfileVersion,
  }
}

function envelopeConsent(data: Record<string, unknown>): ConsentSelector | undefined {
  if (!Object.hasOwn(data, 'consent')) return undefined
  const consent = data.consent
  if (!isRecord(consent)) {
    return { subjectType: 'property', subjectId: '', purpose: '' }
  }
  const expectedFence = envelopeFence(consent.expectedFence)
  if (
    Object.keys(consent).some(
      (key) =>
        key !== 'subjectType' &&
        key !== 'subjectId' &&
        key !== 'purpose' &&
        key !== 'expectedFence',
    ) ||
    (consent.subjectType !== 'organization' &&
      consent.subjectType !== 'property' &&
      consent.subjectType !== 'user') ||
    typeof consent.subjectId !== 'string' ||
    consent.subjectId.length === 0 ||
    typeof consent.purpose !== 'string' ||
    consent.purpose.length === 0 ||
    expectedFence === null
  ) {
    return { subjectType: 'property', subjectId: '', purpose: '' }
  }
  return {
    subjectType: consent.subjectType,
    subjectId: consent.subjectId,
    purpose: consent.purpose,
    ...(expectedFence === undefined ? {} : { expectedFence }),
  }
}

function resolveOrganizationId(
  payload: Record<string, unknown>,
  row: EntryPointRow | undefined,
): string {
  if (typeof payload.organizationId === 'string' && payload.organizationId.length > 0) {
    return payload.organizationId
  }
  if (row && (row.resourceScope === 'tenant_cross' || row.resourceScope === 'none')) {
    return TENANT_CROSS_ORG
  }
  // Missing org on an org/property-scoped row — decide() denies missing_scope.
  return ''
}

async function resolvePropertyId(
  jobName: string,
  payload: Record<string, unknown>,
  resolveScope?: ScopeResolver,
): Promise<string | undefined> {
  if (typeof payload.propertyId === 'string' && payload.propertyId.length > 0) {
    return payload.propertyId
  }
  return resolveScope?.(jobName, payload)
}

function toOutcome(decision: DelayedDecision): GateOutcome {
  if (decision.allowed) return { kind: 'allow', decision }
  if (decision.reason === 'policy_unavailable') return { kind: 'deny_retry', decision }
  return { kind: 'deny_terminal', decision }
}

function rowForJob(jobName: string, executionKind: 'worker' | 'consumer' | 'schedule') {
  if (executionKind === 'schedule') {
    return SCHEDULE_ROW_BY_JOB_NAME.get(jobName) ?? JOB_ROW_BY_NAME.get(jobName)
  }
  return JOB_ROW_BY_NAME.get(jobName)
}

/**
 * Authorize a delayed job or schedule firing against current policy.
 * Unknown job names pass through so decide() denies unknown_action.
 */
export async function gateJob(
  jobName: string,
  data: unknown,
  principalId: string,
  executionKind: 'worker' | 'consumer' | 'schedule',
  resolveScope?: ScopeResolver,
): Promise<GateOutcome> {
  const payload = isRecord(data) ? data : {}
  const row = rowForJob(jobName, executionKind)
  const decision = await getDelayedExecutionPolicy().decide({
    principal: { kind: 'system', id: principalId },
    // Unknown rows pass the job name through — decide() denies unknown_action.
    action: row?.action ?? jobName,
    organizationId: resolveOrganizationId(payload, row),
    propertyId: await resolvePropertyId(jobName, payload, resolveScope),
    capabilityAtEnqueue: envelopeCapability(payload),
    executionKind,
    initiator: envelopeInitiator(payload),
    consent: envelopeConsent(payload),
    policyVersionAtEnqueue:
      typeof payload.policyVersionAtEnqueue === 'string'
        ? payload.policyVersionAtEnqueue
        : undefined,
    correlationId:
      typeof payload.correlationId === 'string' ? payload.correlationId : undefined,
    now: new Date(),
  })
  return toOutcome(decision)
}

export type ScheduledScopeAuthorizer = (
  organizationId: string,
  propertyId?: string,
) => Promise<boolean>

/**
 * Authorizes one concrete target discovered by a tenant-cross schedule.
 * Policy unavailability is retryable; stable scope/capability denials skip
 * only that target so one ineligible tenant cannot block the eligible cohort.
 */
export function createScheduledScopeAuthorizer(
  action: SystemAction,
): ScheduledScopeAuthorizer {
  return async (organizationId, propertyId) => {
    const decision = await getDelayedExecutionPolicy().decide({
      principal: { kind: 'system', id: `schedule:${action}` },
      action,
      organizationId,
      ...(propertyId === undefined ? {} : { propertyId }),
      executionKind: 'schedule',
      now: new Date(),
    })
    if (!decision.allowed && decision.reason === 'policy_unavailable') {
      throw new GateDenyRetryError(action, decision.reason)
    }
    return decision.allowed
  }
}

/** Authorize a durable outbox consumer before its handler runs. */
export async function gateDispatcherConsumer(
  consumerName: string,
  module: string,
  envelope: ConsumerEvent,
): Promise<GateOutcome> {
  const row = CONSUMER_ROW_BY_NAME.get(module)
  const decision = await getDelayedExecutionPolicy().decide({
    principal: { kind: 'system', id: `consumer:${consumerName}` },
    action: row?.action ?? module,
    organizationId: envelope.organizationId,
    propertyId: envelope.propertyId ?? undefined,
    executionKind: 'consumer',
    correlationId: envelope.eventId,
    now: new Date(),
  })
  return toOutcome(decision)
}

// ── Gated worker dispatch ────────────────────────────────────────────

/**
 * BullMQ Job Scheduler firings carry the stable scheduler ID in repeatJobKey.
 * The jobId fallback keeps already-enqueued legacy repeat firings classified
 * correctly during the one-time reconciliation cutover.
 */
function isScheduleFiring(job: Job): boolean {
  if (job.repeatJobKey) return true
  const stableId = job.opts?.jobId ?? job.id ?? ''
  return typeof stableId === 'string' && stableId.includes('-recurring')
}

/**
 * BQC-3.6: enforce the catalogue-declared job timeout. BullMQ v5 removed the
 * job-level `timeout` option, so the race lives here. The handler promise is
 * NOT cancelled on timeout (no AbortController threading) — handlers must
 * stay idempotent under a retry that races a zombie execution.
 */
async function withJobTimeout<TResult>(
  jobName: string,
  timeoutMs: number,
  work: Promise<TResult>,
): Promise<TResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new JobTimeoutError(jobName, timeoutMs)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The dispatch closure shared by the default/background BullMQ workers.
 * Replaces the duplicated inline closures in src/worker/index.ts.
 *
 * Enforcement order: registry lookup → schedule classification → 3.2 policy
 * gate (gateJob) → handler.
 */
export function createGatedJobHandler(
  queueLabel: string,
  registry: JobRegistry,
  resolveScope?: ScopeResolver,
  timeoutForJob: (jobName: string) => number = jobTimeoutMs,
): (job: Job) => Promise<unknown> {
  const logger = getLogger()
  return async (job: Job) => {
    const handler = registry.getHandler(job.name)
    if (!handler) {
      // BQC-3.6: an unknown job name is a deployment/config failure, never a
      // silent ack — throw so the job fails, burns attempts, and lands in the
      // failure quarantine (§4). Boot-time readiness catches the static form.
      logger.error(
        { jobName: job.name },
        'no handler registered for job — failing as deployment/config error',
      )
      throw new UnknownJobError(job.name, job.id)
    }
    const schedule = isScheduleFiring(job)
    const outcome = await gateJob(
      job.name,
      job.data,
      schedule ? `schedule:${job.name}` : `worker:${queueLabel}`,
      schedule ? 'schedule' : 'worker',
      resolveScope,
    )
    if (outcome.kind === 'allow') {
      return withJobTimeout(job.name, timeoutForJob(job.name), handler(job))
    }
    if (outcome.kind === 'deny_terminal') {
      logger.warn(
        {
          jobName: job.name,
          reason: outcome.decision.reason,
          policyVersion: outcome.decision.policyVersion,
        },
        'delayed execution denied — terminal',
      )
      return
    }
    // deny_retry: an unavailable policy is transient — throw so BullMQ
    // retries with backoff instead of running protected work undecided.
    throw new GateDenyRetryError(job.name, outcome.decision.reason)
  }
}
