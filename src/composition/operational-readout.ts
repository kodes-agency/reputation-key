// Composition — the process's operational readout and release seam.
//
// ARC-03-T10/T15. Three cohesive concerns lived inline in the composition root:
//   * the read-only operational queue handles (opened ONCE per process),
//   * the job runtime report and the governed OperationsSnapshot,
//   * the container's shutdown seam.
//
// They belong together because they all describe the PROCESS rather than any
// context, and separating them from the root's context wiring is what makes
// "what does this process observe and release" a single readable unit.

import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Database } from '#/shared/db'
import type { Env } from '#/shared/config/env'
import { createJobQueue, createWorkerBarrierQueue } from '#/shared/jobs/queue'
import { QUARANTINE_QUEUE_NAME } from '#/shared/jobs/failure-quarantine'
import {
  createOperationsSnapshot,
  type OperationsSnapshotDeps,
} from '#/shared/health/operations-snapshot'
import { JOB_OPERATIONAL_CONTRACTS } from '#/shared/jobs/operational-catalogue'
import {
  createJobRuntimeReportReader,
  createQueueJobRuntimeObservationStore,
  type JobRuntimeQueueRedisSource,
} from '#/shared/jobs/runtime-observations'
import { CAPABILITY_POLICY_VERSION } from '#/shared/auth/beta-capabilities'
import { EXECUTION_POLICY_VERSION } from '#/shared/auth/execution-policy'
import { createGoogleSourceContentPolicy } from '#/shared/domain/source-content-policy'
import type { OutboxRepository } from '#/shared/outbox'
import { createContainerShutdown, type ContainerShutdown } from './container-lifecycle'
import type { Infrastructure } from './infrastructure'

export type OperationalReadoutInput = Readonly<{
  db: Database
  outboxRepo: OutboxRepository
  env: Env
  clock: Clock
  logger: LoggerPort
  redis: Redis | undefined
  enableJobs: boolean
  infra: Infrastructure
  /** Identity-owned static policy revision. */
  identity: Readonly<{
    policyStoreVersion: () => number | null
  }>
  /** Notification-owned health gauges the shared snapshot joins. Typed from
   * the snapshot's own contract so the seam cannot drift from its consumer. */
  notification: Readonly<{
    readMissingNotificationCount: OperationsSnapshotDeps['readMissingNotificationCount']
    readNotificationDeliveryLag: OperationsSnapshotDeps['readNotificationDeliveryLag']
  }>
  /** Guest-owned observation-loss gauge. */
  guestObservationLoss: Readonly<{
    read: (
      asOf: Date,
    ) => ReturnType<NonNullable<OperationsSnapshotDeps['readGuestObservationLoss']>>
  }>
  overrides?: Readonly<{
    opsBackgroundQueue?: Queue
    opsDomainEventsQueue?: Queue
    opsQuarantineQueue?: Queue
  }>
}>

/**
 * The ONE governed operational read interface (BQC-5.5). Ops queue read handles
 * (domain-events + quarantine — worker-owned write side) are opened ONCE here,
 * read-only, one Redis connection per queue per process; the
 * /api/health/metrics route and the health-check job both consume these — no
 * per-request or per-module duplicates.
 */
function openOperationsQueues(input: OperationalReadoutInput) {
  const { redis, infra } = input
  const options = input.overrides
  return {
    background:
      options?.opsBackgroundQueue ??
      infra.backgroundQueue ??
      (redis ? createJobQueue('background') : undefined),
    domainEvents:
      options?.opsDomainEventsQueue ??
      (redis ? createJobQueue('domain-events') : undefined),
    quarantine:
      options?.opsQuarantineQueue ??
      (redis ? createJobQueue(QUARANTINE_QUEUE_NAME) : undefined),
  } as const
}

type OperationsQueues = ReturnType<typeof openOperationsQueues>

/**
 * The per-job runtime report, or null when no queue exposes a Redis client to
 * read observations from. A report is never synthesized from an absent store.
 */
function buildJobRuntimeReport(
  input: OperationalReadoutInput,
  opsQueues: OperationsQueues,
) {
  const runtimeObservationQueue = opsQueues.background ?? input.infra.jobQueue
  if (!runtimeObservationQueue || !('client' in runtimeObservationQueue)) return null
  return createJobRuntimeReportReader({
    contracts: JOB_OPERATIONAL_CONTRACTS,
    store: createQueueJobRuntimeObservationStore({
      queue: runtimeObservationQueue as JobRuntimeQueueRedisSource,
    }),
    queues: {
      default: input.infra.jobQueue ?? null,
      background: opsQueues.background ?? null,
    },
    quarantine: opsQueues.quarantine ?? null,
    clock: input.clock,
  })
}

function buildOperationsSnapshot(
  input: OperationalReadoutInput,
  opsQueues: OperationsQueues,
  jobRuntimeReport: ReturnType<typeof buildJobRuntimeReport>,
) {
  const { clock } = input
  return createOperationsSnapshot({
    db: input.db,
    outboxRepo: input.outboxRepo,
    queues: {
      default: input.infra.jobQueue ?? null,
      background: opsQueues.background ?? null,
      domainEvents: opsQueues.domainEvents ?? null,
      quarantine: opsQueues.quarantine ?? null,
    },
    redis: input.redis ?? null,
    clock,
    // BQC-7.3: version identity — the root reads the constants (the shared
    // zone cannot import context domain).
    versions: {
      capabilityPolicy: CAPABILITY_POLICY_VERSION,
      executionPolicy: EXECUTION_POLICY_VERSION,
      policyStore: input.identity.policyStoreVersion,
      sourceContentPolicy: createGoogleSourceContentPolicy().policyVersion,
    },
    // notification.missing_for_inbox_item: the query is the notification
    // context's, the gauge is the shared health snapshot's — the root is the
    // only place allowed to join them.
    readMissingNotificationCount: input.notification.readMissingNotificationCount,
    readNotificationDeliveryLag: input.notification.readNotificationDeliveryLag,
    readGuestObservationLoss: () => input.guestObservationLoss.read(clock()),
    ...(jobRuntimeReport ? { jobRuntime: jobRuntimeReport } : {}),
  })
}

export function buildOperationalReadout(input: OperationalReadoutInput) {
  const opsQueues = openOperationsQueues(input)
  // ARC-03-T15: worker-owned dispatch handles are CONTAINER-owned. The worker
  // entry point used to build its own quarantine barrier queue and its own
  // domain-events queue, so a process had queue connections nobody could
  // enumerate.
  const jobDispatchWorkerRuntime = Object.freeze({
    /** BQC-3.6 dead-letter barrier queue. Written to, never processed.
     * `maxRetriesPerRequest: null` is deliberate: abandoning a quarantine write
     * mid-outage loses the only record of a spent job. */
    quarantineQueue:
      input.enableJobs && input.redis
        ? createWorkerBarrierQueue(QUARANTINE_QUEUE_NAME)
        : undefined,
    /** The outbox relay's publication handle — the same queue the operational
     * read handle observes, so the process opens one connection, not two. */
    domainEventsQueue: opsQueues.domainEvents,
  })
  const jobRuntimeReport = buildJobRuntimeReport(input, opsQueues)
  // No context starts a background policy poller; retain the container-owned
  // shutdown seam for deployable resources added by other composition slices.
  const containerShutdown: ContainerShutdown = createContainerShutdown([], input.logger)

  return Object.freeze({
    opsQueues,
    jobDispatchWorkerRuntime,
    operationsSnapshot: buildOperationsSnapshot(input, opsQueues, jobRuntimeReport),
    containerShutdown,
  } as const)
}
