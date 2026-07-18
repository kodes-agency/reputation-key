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
} from '#/shared/governance/entry-point-catalogue'
import {
  getDelayedExecutionPolicy,
  type DelayedDecision,
} from '#/shared/auth/system-execution-policy'
import type { DomainEvent } from '#/shared/events/events'
import type { ConsumerEvent } from '#/shared/outbox/envelope'
import { getLogger } from '#/shared/observability/logger'
import type { JobRegistry } from './registry'

/**
 * Sentinel organization for tenant_cross/none-scope work that has no org at
 * dispatch (BQC-2.5 fixture pattern: the decision still needs a truthy org to
 * pass scope validation; capability/suspension checks then apply to the
 * sentinel, which is never allowlisted or suspended).
 */
export const TENANT_CROSS_ORG = 'tenant-cross'

/** Content-free envelope extension stamped at enqueue (BQC-3.2 §9). */
export type JobPolicyContext = Readonly<{
  correlationId?: string
  policyVersionAtEnqueue?: string
  initiator?: Readonly<{ kind: 'user' | 'system'; id: string }>
}>

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

function envelopePolicy(data: Record<string, unknown>): JobPolicyContext | undefined {
  return isRecord(data.policy) ? (data.policy as JobPolicyContext) : undefined
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
  const policy = envelopePolicy(payload)
  const decision = await getDelayedExecutionPolicy().decide({
    principal: { kind: 'system', id: principalId },
    // Unknown rows pass the job name through — decide() denies unknown_action.
    action: row?.action ?? jobName,
    organizationId: resolveOrganizationId(payload, row),
    propertyId: await resolvePropertyId(jobName, payload, resolveScope),
    executionKind,
    initiator: policy?.initiator,
    policyVersionAtEnqueue: policy?.policyVersionAtEnqueue,
    correlationId: policy?.correlationId,
    now: new Date(),
  })
  return toOutcome(decision)
}

/** Authorize an in-process bus consumer (registration carries the catalogue name). */
export async function gateBusConsumer(
  consumerModule: string,
  event: DomainEvent,
): Promise<GateOutcome> {
  const row = CONSUMER_ROW_BY_NAME.get(consumerModule)
  const decision = await getDelayedExecutionPolicy().decide({
    principal: { kind: 'system', id: `consumer:${consumerModule}` },
    action: row?.action ?? consumerModule,
    organizationId: event.organizationId as string,
    propertyId: 'propertyId' in event ? (event.propertyId as string) : undefined,
    executionKind: 'consumer',
    correlationId: event.correlationId ?? event.eventId,
    now: new Date(),
  })
  return toOutcome(decision)
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
 * BullMQ repeatable jobs carry repeatJobKey; our schedules additionally use
 * stable '<name>-recurring' jobIds. Both mark a schedule firing rather than
 * an ad-hoc enqueue (verified against node_modules/bullmq Job fields).
 */
function isScheduleFiring(job: Job): boolean {
  if (job.repeatJobKey) return true
  const stableId = job.opts?.jobId ?? job.id ?? ''
  return typeof stableId === 'string' && stableId.includes('-recurring')
}

/**
 * The dispatch closure shared by the default/background BullMQ workers.
 * Replaces the duplicated inline closures in src/worker/index.ts.
 */
export function createGatedJobHandler(
  queueLabel: string,
  registry: JobRegistry,
  resolveScope?: ScopeResolver,
): (job: Job) => Promise<void> {
  const logger = getLogger()
  return async (job: Job) => {
    const handler = registry.getHandler(job.name)
    if (!handler) {
      // Unknown-job quarantine is BQC-3.6 — keep today's warn-and-drain.
      logger.warn({ jobName: job.name, jobId: job.id }, 'no handler registered for job')
      return
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
      await handler(job)
      return
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
    throw new Error(
      `delayed execution denied — retry (${outcome.decision.reason}) for job '${job.name}'`,
    )
  }
}
