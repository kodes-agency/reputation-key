// Feed notification surface — the durable-delivery repair sweep.
//
// Everything beneath the candidate read is production wiring: the route
// consumers the worker registers, enqueueing through the durable delivery
// bridge over the delivery-repair queue, each replay authorized by the delayed
// execution gate against the real policy. The old sweep's tests handed it a
// bare fake queue, which is how it shipped writing an event id no outbox row
// carries. The fake repository applies the same rule the SQL does against an
// in-memory receipt store, so a delivery the sweep repaired and the worker
// settled drops out of the next firing.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job, JobsOptions } from 'bullmq'
import type { DomainEvent } from '#/shared/events/events'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import type { UnpublishedEvent } from '#/shared/outbox'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { inboxItemCreated } from '#/contexts/inbox/domain/events'
import { identityMemberRemoved } from '#/contexts/identity/domain/events'
import { goalMonthlyResultClosed } from '#/contexts/reporting/domain/goal-events'
import type {
  NotificationDeliveryRepairRepositoryPort,
  UnsettledDeliveryCursor,
  UnsettledNotificationDelivery,
} from '../../application/ports/notification-delivery-repair.repository'
import { BETA_NOTIFICATION_TRIGGER_MATRIX } from '../../application/beta-notification-trigger-matrix'
import { createNotificationConsumerDeps } from '../notification-consumer-test-fixtures'
import { registerNotificationConsumers } from '../notification-outbox-consumers'
import { registerIdentityAccountNotificationConsumers } from '../identity-account-outbox-consumers'
import { registerGoalNotificationConsumer } from '../goal-outbox-consumers'
import {
  parseOutboxNotificationDelivery,
  withBetaOutboxNotificationDelivery,
  withDeliveryRepairJobs,
} from '../outbox-notification-delivery'
import type { NotificationJobEnqueuePort } from '../inbox-notification-fanout'
import {
  createReconcileMissingNotificationsHandler,
  DEFAULT_RECONCILE_GRACE_MS,
  DEFAULT_RECONCILE_LOOKBACK_MS,
  JOB_NAME,
  type ReconcileMissingNotificationsDeps,
} from './reconcile-missing-notifications.job'

const ORG = organizationId('org-repair-sweep')
const PROPERTY = propertyId('88000000-0000-4000-8000-000000000001')
const MANAGER = userId('manager-repair-1')
const SECOND_MANAGER = userId('manager-repair-2')
const REMOVED = userId('member-repair-removed')
const NOW = new Date('2026-09-02T12:00:00.000Z')
const MINUTE = 60_000

type Queued = Readonly<{
  name: string
  data: Record<string, unknown>
  opts?: JobsOptions
}>

/**
 * The receipts table as the sweep and the bridge see it: a primary key on
 * (event, consumer), insert-or-ignore, and each receipt's creation time.
 */
function receiptStore(clock: () => Date) {
  const receipts = new Map<string, Readonly<{ status: string; createdAt: Date }>>()
  const key = (eventId: string, consumerName: string) => `${eventId} ${consumerName}`
  return {
    receipts,
    hasReceipt: async (eventId: string, consumerName: string) =>
      receipts.has(key(eventId, consumerName)),
    insertReceipt: async (
      eventId: string,
      consumerName: string,
      status: 'applied' | 'duplicate' | 'obsolete',
    ) => {
      if (!receipts.has(key(eventId, consumerName))) {
        receipts.set(key(eventId, consumerName), { status, createdAt: clock() })
      }
    },
    status: (eventId: string, consumerName: string) =>
      receipts.get(key(eventId, consumerName))?.status,
    enqueuedBefore: (eventId: string, route: string, edge: Date) =>
      [...receipts.entries()].filter(
        ([name, receipt]) =>
          name.startsWith(`${eventId} notification.enqueue:${route}:`) &&
          receipt.createdAt < edge,
      ),
  }
}
type ReceiptStore = ReturnType<typeof receiptStore>

/**
 * BullMQ as the sweep observes it: an add under a job id it still holds, in
 * any state, is a no-op; a held job reports its state and can be removed; and
 * a job that spent its attempts stays held in the failed set. `jobs` is every
 * job the queue accepted, in order.
 */
function recordingQueue() {
  const jobs: Queued[] = []
  const held = new Map<string, 'waiting' | 'failed'>()
  const add = vi.fn(async (name: string, data: unknown, opts?: JobsOptions) => {
    if (opts?.jobId && held.has(opts.jobId)) return
    if (opts?.jobId) held.set(opts.jobId, 'waiting')
    jobs.push({ name, data: data as Record<string, unknown>, ...(opts ? { opts } : {}) })
  })
  const getJob = vi.fn(async (id: string) =>
    held.has(id)
      ? {
          getState: async () => held.get(id)!,
          remove: async () => {
            held.delete(id)
          },
        }
      : undefined,
  )
  return {
    jobs,
    add,
    queue: { add, getJob },
    exhaust: (id: string) => held.set(id, 'failed'),
    stateOf: (id: string) => held.get(id),
  }
}

/** The fact as its producer commits it, stored for the relay. */
function stored(fact: DomainEvent, recordedAt: Date): UnpublishedEvent {
  const row = toOutboxEvent(fact)
  return {
    id: fact.eventId,
    eventType: row.eventType,
    eventVersion: row.eventVersion ?? 1,
    payload: JSON.parse(JSON.stringify(row.payload)),
    organizationId: row.organizationId,
    propertyId: row.propertyId ?? null,
    sourceContext: row.sourceContext,
    sourceAggregateId: row.sourceAggregateId,
    recordedAt,
  }
}

/**
 * The repair read over the store, by the rule the SQL applies: a matrix
 * route's enqueue receipt past the grace edge, with no materialized twin.
 */
function deliveryRepairRepository(
  facts: readonly UnpublishedEvent[],
  store: ReceiptStore,
) {
  const queries: Array<
    Readonly<{ cursor: UnsettledDeliveryCursor | null; limit: number }>
  > = []
  const unsettled = (fact: UnpublishedEvent, route: string, enqueuedBefore: Date) =>
    store
      .enqueuedBefore(fact.id, route, enqueuedBefore)
      .some(
        ([name]) =>
          store.status(
            fact.id,
            name
              .slice(fact.id.length + 1)
              .replace('notification.enqueue:', 'notification.materialized:'),
          ) === undefined,
      )
  const after = (
    delivery: UnsettledNotificationDelivery,
    cursor: UnsettledDeliveryCursor,
  ) =>
    delivery.event.recordedAt > cursor.recordedAt ||
    (delivery.event.recordedAt.getTime() === cursor.recordedAt.getTime() &&
      (delivery.event.id > cursor.eventId ||
        (delivery.event.id === cursor.eventId &&
          delivery.consumerName > cursor.consumerName)))
  const repository: NotificationDeliveryRepairRepositoryPort = {
    findUnsettledDeliveries: async ({
      recordedAtOrAfter,
      enqueuedBefore,
      cursor,
      limit,
    }) => {
      queries.push({ cursor, limit })
      return facts
        .filter((fact) => fact.recordedAt >= recordedAtOrAfter)
        .flatMap((fact) =>
          BETA_NOTIFICATION_TRIGGER_MATRIX.filter(
            (route) =>
              route.eventType === fact.eventType &&
              unsettled(fact, route.consumerName, enqueuedBefore),
          ).map((route) => ({ event: fact, consumerName: route.consumerName })),
        )
        .sort(
          (left, right) =>
            left.event.recordedAt.getTime() - right.event.recordedAt.getTime() ||
            left.event.id.localeCompare(right.event.id) ||
            left.consumerName.localeCompare(right.consumerName),
        )
        .filter((delivery) => cursor === null || after(delivery, cursor))
        .slice(0, limit)
    },
  }
  return { repository, queries }
}

/** The routes this suite exercises, registered over `queue`. */
function registerRoutes(
  queue: NotificationJobEnqueuePort,
  store: ReceiptStore,
  recipients: readonly string[],
): ConsumerRegistry {
  const registry = createConsumerRegistry()
  const fakes = createNotificationConsumerDeps()
  fakes.responsibleManagers.findForPortal.mockResolvedValue(recipients)
  fakes.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
    propertyId: PROPERTY,
    portalId: '88000000-0000-4000-8000-000000000002',
    assignedTo: null,
    propertyName: 'Repair Hotel',
    guestRating: 2,
    sourceType: 'feedback',
    createdAt: NOW,
  })
  fakes.responsibleManagers.findForProperty.mockResolvedValue(recipients)
  const deps = { ...fakes, queue, receipts: store }
  registerNotificationConsumers(registry, deps)
  registerIdentityAccountNotificationConsumers(registry, deps)
  registerGoalNotificationConsumer(registry, {
    ...deps,
    monthlyResultFacts: {
      findMonthlyResultNotificationFacts: vi.fn(async () => ({
        programId: '88000000-0000-4000-8000-000000000030',
        assignmentId: '88000000-0000-4000-8000-000000000031',
        monthlyResultId: '88000000-0000-4000-8000-000000000032',
        programName: 'Monthly rating goal',
        subject: { kind: 'property' as const, propertyId: PROPERTY },
      })),
      findMonthlyResultRevisionNotificationFacts: vi.fn(async () => null),
    },
  })
  return registry
}

type Harness = Readonly<{
  sweep: (job: Job) => Promise<void>
  original: ReturnType<typeof recordingQueue>
  repair: ReturnType<typeof recordingQueue>
  store: ReceiptStore
  queries: ReturnType<typeof deliveryRepairRepository>['queries']
  logger: ReturnType<typeof createNotificationConsumerDeps>['logger']
}>

/**
 * Deliver each fact the way the worker did before anything went wrong — the
 * dispatcher's consumer over the durable bridge — then build the sweep over
 * the same receipts. Jobs Redis accepted then are in `original.jobs`; none of
 * them has settled.
 */
async function deliverThenSweep(
  facts: readonly UnpublishedEvent[],
  options: Readonly<{
    recipients?: readonly string[]
    sweep?: Partial<ReconcileMissingNotificationsDeps>
  }> = {},
): Promise<Harness> {
  let now = new Date(NOW.getTime() - 30 * MINUTE)
  const store = receiptStore(() => now)
  const recipients = options.recipients ?? [MANAGER]
  const original = recordingQueue()
  const delivered = registerRoutes(
    withBetaOutboxNotificationDelivery(original.queue, store),
    store,
    recipients,
  )
  for (const fact of facts) {
    for (const route of delivered.listFor(fact.eventType)) {
      await route.handler(buildConsumerEvent(fact))
    }
  }
  now = NOW

  const repair = recordingQueue()
  const { repository, queries } = deliveryRepairRepository(facts, store)
  const logger = createNotificationConsumerDeps().logger
  const sweep = createReconcileMissingNotificationsHandler({
    deliveries: repository,
    routes: registerRoutes(
      withBetaOutboxNotificationDelivery(
        withDeliveryRepairJobs(repair.queue, store),
        store,
      ),
      store,
      recipients,
    ),
    clock: () => NOW,
    logger,
    ...options.sweep,
  })
  return { sweep, original, repair, store, queries, logger }
}

/** The insert worker settling a queued job: its materialization claim. */
async function settle(store: ReceiptStore, job: Queued, status: 'applied' | 'obsolete') {
  const delivery = parseOutboxNotificationDelivery(job.data)!
  await store.insertReceipt(delivery.eventId, delivery.materializedReceiptName, status)
}

let sequence = 0
const feedbackArrival = (recordedAt = new Date(NOW.getTime() - 30 * MINUTE)) => {
  sequence += 1
  const suffix = String(sequence).padStart(12, '0')
  return stored(
    inboxItemCreated({
      inboxItemId: inboxItemId(`88000000-0000-4000-9000-${suffix}`),
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceType: 'feedback',
      sourceId: feedbackId(`88000000-0000-4000-a000-${suffix}`),
      occurredAt: recordedAt,
    }),
    recordedAt,
  )
}

const job = {} as Job

beforeAll(() => {
  registerAllEventSchemas()
})

beforeEach(() => {
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
  initDelayedExecutionPolicy(
    createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
  )
})

afterEach(() => {
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
})

describe('reconcile-missing-notifications sweep', () => {
  it('is registered under the job name the worker schedules', () => {
    expect(JOB_NAME).toBe('reconcile-missing-notifications')
  })

  it('replays a delivery that never settled under its source fact’s own id and marker', async () => {
    const arrival = feedbackArrival()
    const { sweep, original, repair } = await deliverThenSweep([arrival])
    const lost = original.jobs[0]!

    await sweep(job)

    expect(repair.jobs).toHaveLength(1)
    expect(repair.jobs[0]!.data).toEqual(lost.data)
    expect(parseOutboxNotificationDelivery(repair.jobs[0]!.data)).toMatchObject({
      eventId: arrival.id,
      eventType: 'inbox.inbox_item.created',
      consumerName: 'notification.on-inbox-item-created',
    })
    expect(repair.jobs[0]!.opts?.jobId).toMatch(/^notification-repair-[0-9a-f]{32}$/u)
    expect(repair.jobs[0]!.opts?.jobId).not.toBe(lost.opts?.jobId)
  })

  it('converges on the same repair job when a later firing finds it still unsettled', async () => {
    const { sweep, repair } = await deliverThenSweep([feedbackArrival()])

    await sweep(job)
    await sweep(job)

    expect(repair.add).toHaveBeenCalledTimes(2)
    expect(repair.jobs).toHaveLength(1)
  })

  it('queues a repair again once its own job has spent every attempt', async () => {
    const { sweep, repair } = await deliverThenSweep([feedbackArrival()])
    await sweep(job)
    const repairJobId = repair.jobs[0]!.opts!.jobId!
    // The repair failed too, and BullMQ holds it in the failed set.
    repair.exhaust(repairJobId)

    await sweep(job)

    expect(repair.jobs.map((queued) => queued.opts?.jobId)).toEqual([
      repairJobId,
      repairJobId,
    ])
    expect(repair.stateOf(repairJobId)).toBe('waiting')
  })

  it('queues only the recipients still owed a notification', async () => {
    const { sweep, original, repair, store } = await deliverThenSweep(
      [feedbackArrival()],
      {
        recipients: [MANAGER, SECOND_MANAGER],
      },
    )
    // One recipient's job settled — perhaps with no row, because they muted
    // the type — and the other's was lost.
    await settle(
      store,
      original.jobs.find((queued) => queued.data.userId === MANAGER)!,
      'applied',
    )

    await sweep(job)

    expect(repair.jobs.map((queued) => queued.data.userId)).toEqual([SECOND_MANAGER])
  })

  it('stops once the worker settles the repaired delivery', async () => {
    const { sweep, repair, store } = await deliverThenSweep([feedbackArrival()])

    await sweep(job)
    await settle(store, repair.jobs[0]!, 'obsolete')
    await sweep(job)

    expect(repair.add).toHaveBeenCalledTimes(1)
  })

  it('repairs an Organization-scoped route through the same gate and bridge', async () => {
    const removal = stored(
      identityMemberRemoved({
        organizationId: ORG,
        userId: REMOVED,
        removedBy: MANAGER,
        occurredAt: new Date(NOW.getTime() - 30 * MINUTE),
      }),
      new Date(NOW.getTime() - 30 * MINUTE),
    )
    const { sweep, repair } = await deliverThenSweep([removal])

    await sweep(job)

    expect(repair.jobs).toHaveLength(1)
    expect(repair.jobs[0]!.data).toMatchObject({
      userId: REMOVED,
      propertyId: null,
      type: 'account.organization_access_removed',
      eventId: removal.id,
    })
  })

  it('skips a fact whose route the gate now denies, without failing the firing', async () => {
    const closed = stored(
      goalMonthlyResultClosed({
        organizationId: ORG,
        propertyId: PROPERTY,
        programId: '88000000-0000-4000-8000-000000000030',
        programVersionId: '88000000-0000-4000-8000-000000000033',
        assignmentId: '88000000-0000-4000-8000-000000000031',
        monthlyResultId: '88000000-0000-4000-8000-000000000032',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-09-01T00:00:00.000Z'),
        evaluationState: 'eligible',
        achieved: true,
        occurredAt: new Date(NOW.getTime() - 30 * MINUTE),
      }),
      new Date(NOW.getTime() - 30 * MINUTE),
    )
    const { sweep, original, repair, logger } = await deliverThenSweep([closed])
    expect(original.jobs).toHaveLength(1)
    // Goals are no longer allowlisted for the Organization.
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))

    await expect(sweep(job)).resolves.toBeUndefined()

    expect(repair.jobs).toEqual([])
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ deliveriesSeen: 1, factsReplayed: 0, factsDenied: 1 }),
      'Reconcile missing notifications sweep finished',
    )
  })

  it('does not let one failing replay starve the rest, and still fails the firing', async () => {
    const { sweep, repair } = await deliverThenSweep([
      feedbackArrival(new Date(NOW.getTime() - 40 * MINUTE)),
      feedbackArrival(new Date(NOW.getTime() - 30 * MINUTE)),
    ])
    repair.add.mockRejectedValueOnce(new Error('Queue unavailable'))

    await expect(sweep(job)).rejects.toThrow(
      'reconcile-missing-notifications: 1 of 2 unsettled deliveries failed to replay',
    )
    expect(repair.add).toHaveBeenCalledTimes(2)
    expect(repair.jobs).toHaveLength(1)
  })

  it('reads only past the grace edge and within the lookback, and nothing too fresh', async () => {
    const { sweep, repair, queries } = await deliverThenSweep([
      feedbackArrival(new Date(NOW.getTime() - DEFAULT_RECONCILE_LOOKBACK_MS - MINUTE)),
    ])

    await sweep(job)

    expect(repair.jobs).toEqual([])
    expect(queries).toHaveLength(1)

    // An enqueue inside the grace edge may still be settling.
    const fresh = await deliverThenSweep([feedbackArrival()], {
      sweep: { graceMs: 31 * MINUTE },
    })
    await fresh.sweep(job)
    expect(fresh.repair.jobs).toEqual([])
    expect(DEFAULT_RECONCILE_GRACE_MS).toBe(5 * MINUTE)
  })

  it('holds the batch budget and advances the keyset cursor across batches', async () => {
    const arrivals = [40, 30, 20].map((ageMinutes) =>
      feedbackArrival(new Date(NOW.getTime() - ageMinutes * MINUTE)),
    )
    const { sweep, repair, queries } = await deliverThenSweep(arrivals, {
      sweep: { batchSize: 1, maxBatches: 2 },
    })

    await sweep(job)

    expect(repair.jobs.map((queued) => queued.data.eventId)).toEqual([
      arrivals[0]!.id,
      arrivals[1]!.id,
    ])
    expect(queries.map((query) => query.cursor?.eventId ?? null)).toEqual([
      null,
      arrivals[0]!.id,
    ])
  })
})
