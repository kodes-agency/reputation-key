// Scoped job families — what a family is enqueued with must give the
// delayed-execution gate a scope.
//
// The gate decides an organization- or property-scoped job from the
// Organization and Property in its payload and nowhere else
// (delayed-execution-gate.ts, resolveOrganizationId / resolvePropertyId). A
// producer that leaves them out is refused by nothing: every job completes as
// a terminal `missing_scope` denial, logged as routine, and the work never
// runs. `generate-property-ai-trend` was enqueued with its schedule alone, so
// no Property AI trend was generated until someone read the worker log.
//
// The handler tests could not see it — they hand the handler a payload and
// never ask the gate — and the gate tests could not either, because they type
// their own payloads. So this suite drives each scoped family's real producer
// against a recording queue and puts what it enqueued through the real gate
// and policy. It is exhaustive over the entry-point catalogue: a new scoped
// family fails here until it names how it is enqueued.

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Queue } from 'bullmq'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
  type DelayedDecisionRequest,
} from '#/shared/auth/system-execution-policy'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  ENTRY_POINT_CATALOGUE,
  type EntryPointRow,
} from '#/shared/governance/entry-point-catalogue'
import { gateJob } from '#/shared/jobs/delayed-execution-gate'
import type { OutboxRepository } from '#/shared/outbox'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { walk } from '#/shared/testing/source-tree'
import {
  createAnalyzeReviewNowEnqueue,
  createPropertyTrendEnqueue,
} from '#/contexts/ai/infrastructure/jobs/ai-job-enqueue'
import { handleAiPropertyTrendGenerationRequested } from '#/contexts/ai/infrastructure/outbox-consumers'
import { handleInvitationAcceptedInviterNotice } from '#/contexts/feed/infrastructure/invitation-accepted-inviter-notice'
import { createImmediateEmailEnqueue } from '#/contexts/feed/infrastructure/jobs/immediate-email-enqueue'
import { createNotificationConsumerDeps } from '#/contexts/feed/infrastructure/notification-consumer-test-fixtures'
import { createGoogleImportV2Queue } from '#/contexts/integration/infrastructure/google-import-v2-queue'
import { buildReviewContext } from '#/contexts/review/build'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => createMockLogger(),
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: async (_name: string, fn: () => Promise<unknown>) => fn(),
}))

const ROOT = process.cwd()
const ORGANIZATION = 'scoped-job-enqueue-organization'
const PROPERTY = '5c09ed00-0000-4000-8000-000000000001'
const ID = (suffix: number) =>
  `5c09ed00-0000-4000-8000-${String(suffix).padStart(12, '0')}`

type EnqueuedJob = Readonly<{ name: string; data: unknown }>

function createRecordingQueue() {
  const jobs: EnqueuedJob[] = []
  const queue = {
    add: async (name: string, data: unknown) => {
      jobs.push({ name, data })
      return {}
    },
    addBulk: async (entries: ReadonlyArray<EnqueuedJob>) => {
      for (const entry of entries) jobs.push({ name: entry.name, data: entry.data })
      return []
    },
  }
  return { queue: queue as unknown as Queue, jobs }
}

/** How a scoped family reaches the queue. */
type ScopedJobEnqueue =
  /** Drives the family's own producer; everything it enqueues is gated. */
  | Readonly<{ kind: 'producer'; enqueue: (queue: Queue) => Promise<void> }>
  /**
   * Nothing enqueues the family any more: its handler only drains jobs queued
   * before a rename. `enqueuedAs` are the spellings a producer would use.
   */
  | Readonly<{ kind: 'drain_only'; enqueuedAs: readonly string[] }>

const producer = (enqueue: (queue: Queue) => Promise<void>): ScopedJobEnqueue => ({
  kind: 'producer',
  enqueue,
})

function reviewContext(jobQueue: Queue) {
  return buildReviewContext({
    publicationActorAuthority: async () => true,
    replyBrandProfiles: { isCurrentAiReplyBrandProfile: async () => true },
    db: {} as never,
    outboxRepo: { insertReceipt: vi.fn() } as never,
    clock: () => new Date('2026-10-11T00:00:00Z'),
    idGen: () => 'scoped-job-enqueue-id',
    snapshotRunIdGen: () => 'scoped-job-enqueue-snapshot-run-id',
    googleReviewApi: {} as never,
    jobQueue,
    workerRuntime: {
      pool: {} as never,
      registry: { register: vi.fn() },
      backgroundQueue: undefined,
    },
    logger: createMockLogger(),
    staffPublicApi: {
      getAccessiblePropertyIds: async () => null,
      getAssignedPortals: async () => [],
    },
    propertyApi: {
      getSourceEpoch: async () => ({ sourceEpoch: 0 }),
      getPublicationScope: async () => ({ lifecycleState: 'active', sourceEpoch: 0 }),
    },
  })
}

const receipts = { insertReceipt: async () => undefined } as unknown as OutboxRepository

const SCOPED_JOB_ENQUEUE: Readonly<Record<string, ScopedJobEnqueue>> = {
  'import-gbp-property-item-v2': producer(async (queue) => {
    await createGoogleImportV2Queue(queue).addImportItemJobs([
      {
        jobId: `google-import-item-${ID(2)}`,
        organizationId: ORGANIZATION,
        importJobId: ID(3),
        itemId: ID(2),
        retryRevision: 0,
      },
    ])
  }),
  'sync-property-reviews': producer(async (queue) => {
    const review = reviewContext(queue)
    await review.internal.repos.queue.addSyncJob({
      organizationId: ORGANIZATION,
      propertyId: PROPERTY,
      connectionId: 'connection-1',
      locationName: 'locations/1',
    })
    await review.publicApi.syncAdmission.addTargetedFetchJob(
      {
        mode: 'targeted',
        organizationId: ORGANIZATION,
        propertyId: PROPERTY,
        connectionId: 'connection-1',
        sourceEpoch: 3,
        referenceRef: `v1.${Buffer.alloc(32, 5).toString('base64url')}`,
        deliveryId: ID(4),
        initiator: { kind: 'system', id: 'webhook:gbp' },
      },
      { jobId: `gbp-push-${ID(4)}` },
    )
  }),
  'publish-reply': producer(async (queue) => {
    await reviewContext(queue).internal.repos.replyQueue.addPublishJob({
      replyId: ID(5),
      organizationId: ORGANIZATION,
      propertyId: PROPERTY,
      publicationCycle: 1,
      initiator: { kind: 'user', id: 'manager-1' },
    })
  }),
  // From the durable request, not from the enqueue alone: the consumer chose
  // what to hand the queue, and it handed over the schedule without its scope.
  'generate-property-ai-trend': producer(async (queue) => {
    await handleAiPropertyTrendGenerationRequested(
      {
        enqueuePropertyTrend: createPropertyTrendEnqueue(queue),
        analyzeReviewEvent: async () => ({ status: 'completed' }),
        backlog: { enqueue: async () => undefined },
        nowEpochMillis: () => Date.parse('2026-10-11T00:00:00Z'),
        receipts,
      },
      {
        eventId: ID(6),
        eventType: 'ai.property_trend.generation_requested',
        eventVersion: 1,
        payload: {
          scheduleId: ID(7),
          organizationId: ORGANIZATION,
          propertyId: PROPERTY,
        },
        organizationId: ORGANIZATION,
        propertyId: PROPERTY,
        sourceContext: 'ai',
        sourceAggregateId: ID(7),
      },
    )
  }),
  'ai-review-analysis-on-demand': producer(async (queue) => {
    await createAnalyzeReviewNowEnqueue(queue)({
      organizationId: ORGANIZATION,
      propertyId: PROPERTY,
      reviewId: ID(8),
    })
  }),
  // An Organization-wide notice: the notification with no Property to lean on.
  'insert-notification': producer(async (queue) => {
    const fakes = createNotificationConsumerDeps()
    await handleInvitationAcceptedInviterNotice(
      { queue, receipts, displayNames: fakes.displayNames, logger: fakes.logger },
      {
        eventId: ID(9),
        eventType: 'identity.invitation.accepted',
        eventVersion: 1,
        payload: {
          organizationId: ORGANIZATION,
          userId: 'member-1',
          invitationId: 'invitation-1',
          inviterId: 'admin-1',
        },
        organizationId: ORGANIZATION,
        propertyId: null,
        sourceContext: 'identity',
        sourceAggregateId: 'invitation-1',
        recordedAt: '2026-10-11T00:00:00.000Z',
      },
    )
  }),
  'urgent-email': producer(async (queue) => {
    await createImmediateEmailEnqueue(
      queue,
      'notification:scoped-job-enqueue',
    )({
      notificationEmailId: ID(10),
      organizationId: ORGANIZATION,
      propertyId: PROPERTY,
    })
  }),
  // A mandatory notice is Organization-wide: it is enqueued with no Property.
  'mandatory-email': producer(async (queue) => {
    await createImmediateEmailEnqueue(
      queue,
      'notification:scoped-job-enqueue',
    )({
      notificationEmailId: ID(11),
      organizationId: ORGANIZATION,
    })
  }),
  'project-recent-activity': {
    kind: 'drain_only',
    enqueuedAs: ["'project-recent-activity'", 'PROJECT_RECENT_ACTIVITY_JOB_NAME'],
  },
  'insert-activity-log': {
    kind: 'drain_only',
    enqueuedAs: ["'insert-activity-log'", 'LEGACY_INSERT_ACTIVITY_LOG_JOB_NAME'],
  },
}

const SCOPED_JOB_ROWS: ReadonlyArray<EntryPointRow> = ENTRY_POINT_CATALOGUE.filter(
  (row) =>
    row.kind === 'job' &&
    (row.resourceScope === 'organization' || row.resourceScope === 'property'),
)

const rowsEnqueuedBy = (kind: ScopedJobEnqueue['kind']) =>
  SCOPED_JOB_ROWS.filter((row) => SCOPED_JOB_ENQUEUE[row.name]?.kind === kind).map(
    (row) => [row.name, row] as const,
  )

/** Production sources that pass one of these spellings to a queue as a job name. */
function sourcesEnqueuing(spellings: readonly string[]): string[] {
  const name = spellings.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const enqueue = new RegExp(
    `\\badd\\(\\s*(?:${name})\\s*,|\\bname:\\s*(?:${name})\\s*,`,
    'u',
  )
  return walk(join(ROOT, 'src'))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .filter((file) => enqueue.test(readFileSync(file, 'utf8')))
    .map((file) => relative(ROOT, file))
}

describe('scoped job families are enqueued with the scope the gate decides on', () => {
  const requests: DelayedDecisionRequest[] = []

  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
    requests.length = 0
    resetCapabilityPolicyStore()
    // Every controlled capability open: a denial here can only be about scope.
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({ BETA_ALLOWLIST_ORGS: '*' }),
    )
    const policy = createDelayedExecutionPolicy({ refreshPolicy: async () => {} })
    initDelayedExecutionPolicy({
      decide: (request) => {
        requests.push(request)
        return policy.decide(request)
      },
    })
  })

  afterEach(() => {
    resetDelayedExecutionPolicy()
    resetCapabilityPolicyStore()
    clearEventSchemas()
  })

  it('names how every organization- and property-scoped job family is enqueued', () => {
    expect(SCOPED_JOB_ROWS.length).toBeGreaterThan(0)
    expect(Object.keys(SCOPED_JOB_ENQUEUE).sort()).toEqual(
      SCOPED_JOB_ROWS.map((row) => row.name).sort(),
    )
  })

  it.each(rowsEnqueuedBy('producer'))(
    '%s is allowed for the Organization and Property its producer enqueued',
    async (jobName, row) => {
      const entry = SCOPED_JOB_ENQUEUE[jobName]
      if (entry?.kind !== 'producer') throw new Error(`no producer for ${jobName}`)
      const { queue, jobs } = createRecordingQueue()

      await entry.enqueue(queue)

      const enqueued = jobs.filter((job) => job.name === jobName)
      expect(enqueued.length, `${jobName} producer enqueued nothing`).toBeGreaterThan(0)
      for (const job of enqueued) {
        requests.length = 0
        const outcome = await gateJob(jobName, job.data, 'worker:default', 'worker')

        expect(
          { jobName, reason: outcome.decision.reason },
          `${jobName} must be enqueued with organizationId${
            row.resourceScope === 'property' ? ' and propertyId' : ''
          }: the gate reads its scope from the job payload`,
        ).toEqual({ jobName, reason: 'allowed' })
        expect(requests).toHaveLength(1)
        expect(requests[0]?.organizationId).toBe(ORGANIZATION)
        if (row.resourceScope === 'property') {
          expect(requests[0]?.propertyId).toBe(PROPERTY)
        }
      }
    },
  )

  it.each(rowsEnqueuedBy('drain_only'))(
    '%s has no producer left to enqueue it without a scope',
    (jobName) => {
      const entry = SCOPED_JOB_ENQUEUE[jobName]
      if (entry?.kind !== 'drain_only') throw new Error(`${jobName} is not drain-only`)

      expect(
        sourcesEnqueuing(entry.enqueuedAs),
        `${jobName} is enqueued again: register its producer in SCOPED_JOB_ENQUEUE`,
      ).toEqual([])
    },
  )
})
