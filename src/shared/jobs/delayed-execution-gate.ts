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
// BQC-4.2 adds a ROUTING GATE after a policy allow and before the handler
// (ADR 0048): property-scoped protected jobs re-resolve the property's
// current routing through the ProcessingRouter; blocked or wrong-cell jobs
// are quarantined (fail closed, no retry burn, no side effect). The stamped
// routing envelope is telemetry only — a payload region is never accepted on
// its own; the fresh resolution is the authority.
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
import {
  workloadClassForJob,
  type ProcessingRouter,
  type RoutingEnvelope,
} from '#/shared/routing/processing-router'
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

/**
 * BQC-3.2: the event-bus authorizer wired by the composition root
 * (src/composition.ts) — injected so the bus module itself never imports
 * the server-only policy stack (browser/Storybook bundles stay clean).
 * deny_terminal skips with a warning; deny_retry skips with an error — the
 * bus is fire-and-forget with no retry semantics, so retries belong to the
 * durable dispatcher path (BQC-3.3–3.5), not here.
 */
export function createBusAuthorizer() {
  const logger = getLogger()
  return async (consumer: string, event: DomainEvent): Promise<boolean> => {
    const outcome = await gateBusConsumer(consumer, event)
    if (outcome.kind === 'allow') return true
    if (outcome.kind === 'deny_terminal') {
      logger.warn(
        { consumer, tag: event._tag, reason: outcome.decision.reason },
        'delayed execution denied — terminal (event bus consumer skipped)',
      )
      return false
    }
    logger.error(
      { consumer, tag: event._tag, reason: outcome.decision.reason },
      'delayed execution denied — policy unavailable (event bus consumer skipped)',
    )
    return false
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
 * BQC-4.2 dispatch-time routing enforcement (ADR 0048). Wired by the worker:
 * the ProcessingRouter (production property-routing adapter), the worker's
 * declared cell (PROCESSING_CELL env), and the direct-quarantine callback.
 */
export type JobRoutingGate = Readonly<{
  router: ProcessingRouter
  /** The worker's declared cell — a target for any other cell is rejected. */
  cell: string
  /** Parks the rejected job in the dead-letter quarantine queue. */
  quarantine: (job: Job, policyReason: string) => Promise<void>
}>

/**
 * Routing gate for one job: only property-scoped protected jobs route
 * (workloadClassForJob + the catalogue row's resourceScope — tenant-cross
 * sweeps and org-scoped fan-outs never route). The router re-resolves CURRENT
 * routing facts; the stamped envelope is telemetry and never influences the
 * outcome. Returns true when the job may proceed to its handler.
 */
async function enforceJobRouting(
  job: Job,
  routing: JobRoutingGate,
  resolveScope: ScopeResolver | undefined,
): Promise<boolean> {
  const logger = getLogger()
  const workloadClass = workloadClassForJob(job.name)
  if (!workloadClass) return true
  const row = JOB_ROW_BY_NAME.get(job.name)
  if (row?.resourceScope !== 'property') return true

  const payload = isRecord(job.data) ? job.data : {}
  const propertyId = await resolvePropertyId(job.name, payload, resolveScope)
  if (!propertyId) {
    // Fail closed: a routed job whose property scope cannot be established
    // must never run unrouted (the 3.2 policy gate normally denies first).
    logger.warn(
      { jobName: job.name, jobId: job.id },
      'job routing scope unresolved — quarantining (fail closed)',
    )
    await routing.quarantine(job, 'routing_blocked:property_missing')
    return false
  }

  const decision = await routing.router.resolve(propertyId, workloadClass)
  if (decision.kind === 'blocked') {
    logger.warn(
      {
        jobName: job.name,
        jobId: job.id,
        propertyId,
        reason: decision.reason,
        region: decision.region,
      },
      'job routing blocked — quarantining (fail closed)',
    )
    await routing.quarantine(job, `routing_blocked:${decision.reason}`)
    return false
  }
  if (decision.cell !== routing.cell) {
    logger.warn(
      {
        jobName: job.name,
        jobId: job.id,
        propertyId,
        targetCell: decision.cell,
        workerCell: routing.cell,
      },
      'job routed to another cell — quarantining (wrong cell)',
    )
    await routing.quarantine(job, 'wrong_cell')
    return false
  }

  // Matching cell → proceed. A stamped envelope whose policy version differs
  // from the fresh resolution is stale: re-resolution IS the reschedule with
  // one cell — proceed on the fresh decision and log the drift. A stamped
  // region is never compared for authority: the fresh resolution decides.
  const envelope = isRecord(payload.routing)
    ? (payload.routing as RoutingEnvelope)
    : undefined
  if (envelope && envelope.routingPolicyVersion !== decision.routingPolicyVersion) {
    logger.info(
      {
        jobName: job.name,
        jobId: job.id,
        propertyId,
        stampedVersion: envelope.routingPolicyVersion,
        resolvedVersion: decision.routingPolicyVersion,
      },
      'stale routing envelope — re-resolved at dispatch',
    )
  }
  return true
}

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
 * BQC-3.6: enforce the catalogue-declared job timeout. BullMQ v5 removed the
 * job-level `timeout` option, so the race lives here. The handler promise is
 * NOT cancelled on timeout (no AbortController threading) — handlers must
 * stay idempotent under a retry that races a zombie execution.
 */
async function withJobTimeout(
  jobName: string,
  timeoutMs: number,
  work: Promise<void>,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
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
 * gate (gateJob) → 4.2 routing gate (when wired) → handler.
 */
export function createGatedJobHandler(
  queueLabel: string,
  registry: JobRegistry,
  resolveScope?: ScopeResolver,
  routing?: JobRoutingGate,
  timeoutForJob: (jobName: string) => number = jobTimeoutMs,
): (job: Job) => Promise<void> {
  const logger = getLogger()
  return async (job: Job) => {
    const handler = registry.getHandler(job.name)
    if (!handler) {
      // BQC-3.6: an unknown job name is a deployment/config failure, never a
      // silent ack — throw so the job fails, burns attempts, and lands in the
      // failure quarantine (§4). Boot-time readiness catches the static form.
      logger.error(
        { jobName: job.name, jobId: job.id },
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
      // BQC-4.2: after the policy allow, before any side effect — re-resolve
      // routing. Blocked/wrong-cell jobs are quarantined and return WITHOUT
      // running the handler and without burning retries (fail closed).
      if (routing && !(await enforceJobRouting(job, routing, resolveScope))) return
      await withJobTimeout(job.name, timeoutForJob(job.name), handler(job))
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
    throw new GateDenyRetryError(job.name, outcome.decision.reason)
  }
}
