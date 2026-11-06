import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  notificationEmailQueue,
  notificationPreferences,
  notifications,
  outboxEvents,
  properties,
  inboxItems,
} from '#/shared/db/schema'
import { notificationEmailId, notificationId, inboxItemId } from '#/shared/domain/ids'
import type { DomainEvent } from '#/shared/events/events'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  currentRouteDeps,
  dispatch,
} from '#/shared/testing/notification-route-test-harness'
import {
  ACTOR,
  BULK,
  DEPARTING,
  handlingCycleScope,
  ITEM,
  MANAGER,
  OCCURRED_AT,
  ORG,
  PRODUCED_FACTS,
  PROPERTY,
  RECIPIENT,
} from '#/shared/testing/notification-route-producer-fixtures'
import {
  inboxBulkAssignmentCompleted,
  inboxBulkReopenCompleted,
  inboxHandlingCycleReopened,
  inboxItemAssigned,
} from '#/contexts/inbox/domain/events'
import { createRetireMovedAssignment } from '../../application/retire-moved-assignment'
import { parseNotificationPayload } from '../../domain/notification-payload'
import type { InsertNotificationJobData } from '../jobs/insert-notification.job'
import { parseOutboxNotificationDelivery } from '../outbox-notification-delivery'
import { createNotificationDeliverySettlement } from './notification-delivery-settlement.repository'
import { createNotificationEmailRepository } from './notification-email.repository'
import { createNotificationRepository } from './notification.repository'

const SECOND_ITEM = inboxItemId('4d1f0c1e-2b7a-4c55-9a51-000000000031')
const AFTER = new Date('2026-09-02T10:00:00.000Z')
const AGAIN = new Date('2026-09-02T11:00:00.000Z')
const RECORDING_CLOCKS = [
  { name: 'increasing', times: [OCCURRED_AT, AFTER, AGAIN] },
  { name: 'tied', times: [OCCURRED_AT, OCCURRED_AT, OCCURRED_AT] },
  { name: 'reversed', times: [AGAIN, AFTER, OCCURRED_AT] },
] as const

function latch() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe.sequential('Inbox workflow delivery races (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database
  let now: Date
  let commandRevision: number

  const clear = async () => {
    await db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.organizationId, ORG))
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
    await db.delete(inboxItems).where(eq(inboxItems.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
  }

  beforeAll(async () => {
    registerAllEventSchemas()
    lease = await acquireTestLease(getEnv().DATABASE_URL, 5)
    db = drizzle(lease.pool) as Database
  })

  beforeEach(async () => {
    await clear()
    now = OCCURRED_AT
    commandRevision = 1
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({ BETA_ALLOWLIST_ORGS: ORG }),
    )
    initDelayedExecutionPolicy(
      createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
    )
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Riverside Hotel',
      slug: 'inbox-workflow-delivery',
      timezone: 'UTC',
    })
    await db.insert(notificationPreferences).values(
      [RECIPIENT, DEPARTING, MANAGER].flatMap((userId) =>
        (['in_app', 'email'] as const).map((channel) => ({
          userId,
          organizationId: ORG,
          propertyId: PROPERTY,
          category: 'workflow_collaboration',
          channel,
          enabled: true,
          cadence: 'immediate',
        })),
      ),
    )
  })

  afterAll(async () => {
    try {
      if (db) await clear()
    } finally {
      resetDelayedExecutionPolicy()
      resetCapabilityPolicyStore()
      await lease?.release()
    }
  })

  const persist = async (...facts: DomainEvent[]) => {
    await db.insert(outboxEvents).values(
      facts.map((fact) => ({
        ...toOutboxEvent(fact),
        id: fact.eventId,
        createdAt: now,
        publishedAt: now,
      })),
    )
  }

  const dependencies = () => {
    const deps = currentRouteDeps()
    return {
      ...deps,
      clock: () => now,
      retireMovedAssignment: vi.fn(
        createRetireMovedAssignment({
          notifications: createNotificationRepository(db),
          emails: createNotificationEmailRepository(db),
        }),
      ),
    }
  }

  const materialize = async (jobs: readonly InsertNotificationJobData[]) => {
    const settlement = createNotificationDeliverySettlement({
      db,
      clock: () => now,
      idGen: () => notificationId(randomUUID()),
      emailIdGen: () => notificationEmailId(randomUUID()),
      logger: currentRouteDeps().logger,
      ratingForRouting: async () => null,
    })
    return Promise.all(
      jobs.map(({ audience, delivery: _delivery, ...input }) => {
        const delivery = parseOutboxNotificationDelivery({
          ...input,
          audience,
          delivery: _delivery,
        })
        expect(delivery).not.toBeNull()
        return settlement.settleAuthorized(input, delivery!, audience)
      }),
    )
  }

  const stored = async () => ({
    notices: await db
      .select()
      .from(notifications)
      .where(eq(notifications.organizationId, ORG)),
    mail: await db
      .select()
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG)),
  })

  const assignment = (
    assignedTo: typeof RECIPIENT,
    previousAssignee: typeof RECIPIENT | null,
    occurredAt: Date,
  ) =>
    inboxItemAssigned({
      inboxItemId: ITEM,
      organizationId: ORG,
      propertyId: PROPERTY,
      assignedTo,
      previousAssignee,
      commandRevision: ++commandRevision,
      userId: ACTOR,
      occurredAt,
    })

  // Both dispatches must pass the receipt check before either handler runs.
  const concurrentDispatch = async (facts: readonly DomainEvent[]) => {
    const deps = dependencies()
    const outbox = createOutboxRepository(db)
    const checks = new Map<string, ReturnType<typeof latch>>()
    const hasReceipt: typeof outbox.hasReceipt = async (eventId, consumerName) => {
      const exists = await outbox.hasReceipt(eventId, consumerName)
      const key = `${eventId}:${consumerName}`
      const waiting = checks.get(key)
      if (waiting) waiting.release()
      else {
        const gate = latch()
        checks.set(key, gate)
        await gate.promise
      }
      return exists
    }
    return Promise.all(
      facts
        .flatMap((fact) => [fact, fact])
        .map((fact) => dispatch(fact, deps, { outbox: { ...outbox, hasReceipt } })),
    )
  }

  it.each([
    'inbox.inbox_item.assigned',
    'inbox.inbox_item.escalated',
    'inbox.inbox_note.added',
  ])(
    '%s materializes concurrent duplicate deliveries once, including mail',
    async (eventType) => {
      const fact = PRODUCED_FACTS[eventType]!()
      await persist(fact)
      const results = await concurrentDispatch([fact])
      expect(results.flatMap(({ gateDenials }) => gateDenials)).toEqual([])
      const jobs = results.flatMap(({ queued }) => queued)
      const expectedRecipients =
        eventType === 'inbox.inbox_item.assigned' ? [RECIPIENT, DEPARTING] : [MANAGER]
      expect(jobs).toHaveLength(expectedRecipients.length * 2)

      const outcomes = await materialize(jobs)

      expect(outcomes.filter((outcome) => outcome === 'applied')).toHaveLength(
        expectedRecipients.length,
      )
      expect(outcomes.filter((outcome) => outcome === 'duplicate')).toHaveLength(
        expectedRecipients.length,
      )
      const { notices, mail } = await stored()
      expect(notices.map(({ userId }) => userId).sort()).toEqual(
        [...expectedRecipients].sort(),
      )
      expect(
        notices.every((row) => row.coalescedCount === 1 && row.resolvedAt === null),
      ).toBe(true)
      expect(mail).toHaveLength(expectedRecipients.length)
      expect(mail.map(({ notificationId }) => notificationId).sort()).toEqual(
        notices.map(({ id }) => id).sort(),
      )
      expect(mail.every(({ status }) => status === 'pending')).toBe(true)
      expect(
        (await dispatch(fact, dependencies(), { outbox: createOutboxRepository(db) }))
          .queued,
      ).toEqual([])
    },
  )

  it.each(['assignment', 'reopen'] as const)(
    '%s: concurrent per-item and duplicate bulk facts announce only the groups',
    async (family) => {
      const items = [ITEM, SECOND_ITEM]
      const perItem = items.map((item) =>
        family === 'assignment'
          ? inboxItemAssigned({
              inboxItemId: item,
              organizationId: ORG,
              propertyId: PROPERTY,
              assignedTo: RECIPIENT,
              previousAssignee: DEPARTING,
              userId: ACTOR,
              bulkId: BULK,
              occurredAt: OCCURRED_AT,
            })
          : inboxHandlingCycleReopened({
              ...handlingCycleScope,
              inboxItemId: item,
              actorType: 'user',
              userId: ACTOR,
              bulkId: BULK,
              reopenReason: 'new_information',
              source: 'web',
            }),
      )
      const bulk =
        family === 'assignment'
          ? inboxBulkAssignmentCompleted({
              organizationId: ORG,
              userId: ACTOR,
              bulkId: BULK,
              occurredAt: OCCURRED_AT,
              transitions: items.map((inboxItemId) => ({
                inboxItemId,
                propertyId: PROPERTY,
                previousAssignee: DEPARTING,
                nextAssignee: RECIPIENT,
              })),
            })
          : inboxBulkReopenCompleted({
              organizationId: ORG,
              userId: ACTOR,
              bulkId: BULK,
              occurredAt: OCCURRED_AT,
              reopened: items.map((inboxItemId) => ({
                ...handlingCycleScope,
                inboxItemId,
              })),
            })
      await persist(...perItem, bulk)
      const results = await concurrentDispatch([...perItem, bulk])
      expect(results.flatMap(({ gateDenials }) => gateDenials)).toEqual([])
      const jobs = results.flatMap(({ queued }) => queued)
      expect(jobs.every((job) => job.eventId === bulk.eventId)).toBe(true)
      const expected =
        family === 'assignment'
          ? ['inbox.bulk_assigned', 'inbox.bulk_unassigned']
          : ['inbox.bulk_reopened']
      expect(jobs).toHaveLength(expected.length * 2)

      const outcomes = await materialize(jobs)

      expect(outcomes.filter((outcome) => outcome === 'applied')).toHaveLength(
        expected.length,
      )
      expect(outcomes.filter((outcome) => outcome === 'duplicate')).toHaveLength(
        expected.length,
      )
      const { notices, mail } = await stored()
      expect(notices.map(({ type }) => type).sort()).toEqual(expected.sort())
      expect(
        notices.every(
          (row) =>
            row.coalescedCount === 1 &&
            parseNotificationPayload(row.payload).itemCount === 2,
        ),
      ).toBe(true)
      expect(mail).toHaveLength(expected.length)
      expect(mail.map(({ notificationId }) => notificationId).sort()).toEqual(
        notices.map(({ id }) => id).sort(),
      )
      expect(mail.every(({ status }) => status === 'pending')).toBe(true)
    },
  )

  it('deduplicates concurrent email-only delivery without an unread row to coalesce into', async () => {
    await db
      .update(notificationPreferences)
      .set({ enabled: false })
      .where(
        and(
          eq(notificationPreferences.organizationId, ORG),
          eq(notificationPreferences.channel, 'in_app'),
        ),
      )
    const fact = PRODUCED_FACTS['inbox.inbox_note.added']!()
    await persist(fact)
    const results = await concurrentDispatch([fact])

    expect((await materialize(results.flatMap(({ queued }) => queued))).sort()).toEqual([
      'applied',
      'duplicate',
    ])

    const { notices, mail } = await stored()
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      userId: MANAGER,
      status: 'read',
      readAt: null,
      resolvedAt: null,
      coalescedCount: 1,
    })
    expect(mail).toHaveLength(1)
    expect(mail[0]).toMatchObject({ notificationId: notices[0]!.id, status: 'pending' })
  })

  it.each(RECORDING_CLOCKS)(
    'a delayed removal preserves a coalesced assignment with $name recording timestamps',
    async ({ times }) => {
      now = times[0]
      const outbox = createOutboxRepository(db)
      const deps = dependencies()
      const first = assignment(RECIPIENT, null, OCCURRED_AT)
      await persist(first)
      await materialize((await dispatch(first, deps, { outbox })).queued)
      const [original] = (await stored()).notices

      now = times[1]
      const removed = assignment(DEPARTING, RECIPIENT, OCCURRED_AT)
      await persist(removed)
      now = times[2]
      // Both source and recording clocks may repeat or move backwards.
      const reassigned = assignment(RECIPIENT, DEPARTING, OCCURRED_AT)
      await persist(reassigned)
      await materialize((await dispatch(reassigned, deps, { outbox })).queued)
      await materialize((await dispatch(removed, deps, { outbox })).queued)

      const { notices, mail } = await stored()
      expect(
        notices.filter(
          (row) => row.type === 'inbox.assigned' && row.userId === RECIPIENT,
        ),
      ).toEqual([
        expect.objectContaining({
          id: original!.id,
          coalescedCount: 2,
          status: 'unread',
          resolvedAt: null,
        }),
      ])
      const currentMail = mail.filter(
        ({ notificationId }) => notificationId === original!.id,
      )
      expect(currentMail).toHaveLength(1)
      expect(currentMail[0]).toMatchObject({ status: 'pending', suppressionReason: null })
    },
  )

  it.each(
    RECORDING_CLOCKS.flatMap(({ name, times }) =>
      (['consumer', 'notification job'] as const).flatMap((delay) =>
        [false, true].map((emailOnly) => ({ name, times, delay, emailOnly })),
      ),
    ),
  )(
    'a delayed removal $delay leaves reassigned notice and mail open with $name timestamps (email-only: $emailOnly)',
    async ({ delay, times, emailOnly }) => {
      if (emailOnly) {
        await db
          .update(notificationPreferences)
          .set({ enabled: false })
          .where(
            and(
              eq(notificationPreferences.organizationId, ORG),
              eq(notificationPreferences.userId, RECIPIENT),
              eq(notificationPreferences.channel, 'in_app'),
            ),
          )
      }
      const expectedStatus = emailOnly ? 'read' : 'unread'
      now = times[0]
      const outbox = createOutboxRepository(db)
      const deps = dependencies()
      const first = assignment(RECIPIENT, null, OCCURRED_AT)
      await persist(first)
      await materialize((await dispatch(first, deps, { outbox })).queued)
      const [original] = (await stored()).notices
      expect(original).toBeDefined()

      now = times[1]
      const removed = assignment(DEPARTING, RECIPIENT, OCCURRED_AT)
      await persist(removed)
      const entered = latch()
      const resume = latch()
      let delayed: ReturnType<typeof dispatch> | undefined
      if (delay === 'consumer') {
        const retire = deps.retireMovedAssignment.getMockImplementation()!
        deps.retireMovedAssignment.mockImplementationOnce(async (input) => {
          entered.release()
          await resume.promise
          await retire(input)
        })
        delayed = dispatch(removed, deps, { outbox })
        await entered.promise
      }
      try {
        const removal = await dispatch(removed, deps, { outbox })
        if (delay === 'consumer') await materialize(removal.queued)
        const old = await stored()
        expect(old.notices.find(({ id }) => id === original!.id)).toMatchObject({
          resolvedAt: times[1],
        })
        expect(
          old.mail.find(({ notificationId }) => notificationId === original!.id)?.status,
        ).toBe('cancelled')

        now = times[2]
        const reassigned = assignment(RECIPIENT, DEPARTING, OCCURRED_AT)
        await persist(reassigned)
        await materialize((await dispatch(reassigned, deps, { outbox })).queued)
        const current = (await stored()).notices.find(
          (row) => row.eventId === reassigned.eventId && row.userId === RECIPIENT,
        )
        expect(current).toMatchObject({ status: expectedStatus, resolvedAt: null })
        expect(current!.id).not.toBe(original!.id)

        if (delay === 'consumer') {
          resume.release()
          await materialize((await delayed!).queued)
        } else await materialize(removal.queued)

        const final = await stored()
        expect(final.notices.find(({ id }) => id === current!.id)).toMatchObject({
          status: expectedStatus,
          resolvedAt: null,
        })
        const currentMail = final.mail.filter(
          ({ notificationId }) => notificationId === current!.id,
        )
        expect(currentMail).toHaveLength(1)
        expect(currentMail[0]).toMatchObject({
          status: 'pending',
          suppressionReason: null,
        })
      } finally {
        resume.release()
        await delayed
      }
    },
  )
  it.each(RECORDING_CLOCKS)(
    'retires the current assignment and mail with $name recording timestamps',
    async ({ times }) => {
      const outbox = createOutboxRepository(db)
      const deps = dependencies()
      now = times[0]
      const first = assignment(RECIPIENT, null, OCCURRED_AT)
      await persist(first)
      await materialize((await dispatch(first, deps, { outbox })).queued)
      const [original] = (await stored()).notices

      now = times[1]
      const removed = assignment(DEPARTING, RECIPIENT, OCCURRED_AT)
      await persist(removed)
      await materialize((await dispatch(removed, deps, { outbox })).queued)

      const { notices, mail } = await stored()
      expect(notices.find(({ id }) => id === original!.id)).toMatchObject({
        resolvedAt: times[1],
      })
      expect(
        mail.find(({ notificationId }) => notificationId === original!.id),
      ).toMatchObject({
        status: 'cancelled',
      })
    },
  )

  it.each(
    [RECIPIENT, DEPARTING].flatMap((currentAssignee) =>
      [false, true].map((versionedRemoval) => ({ currentAssignee, versionedRemoval })),
    ),
  )(
    'retirement follows durable ownership when assignee is $currentAssignee (versioned removal: $versionedRemoval)',
    async ({ currentAssignee, versionedRemoval }) => {
      const outbox = createOutboxRepository(db)
      const deps = dependencies()
      const { commandRevision: _firstRevision, ...first } = assignment(
        RECIPIENT,
        null,
        OCCURRED_AT,
      )
      await persist(first)
      await materialize((await dispatch(first, deps, { outbox })).queued)
      const [original] = (await stored()).notices
      const { commandRevision: _removedRevision, ...removed } = assignment(
        DEPARTING,
        RECIPIENT,
        OCCURRED_AT,
      )
      const removal = versionedRemoval
        ? { ...removed, commandRevision: _removedRevision }
        : removed
      await persist(removal)
      if (currentAssignee === RECIPIENT) {
        const { commandRevision: _nextRevision, ...reassigned } = assignment(
          RECIPIENT,
          DEPARTING,
          OCCURRED_AT,
        )
        await persist(reassigned)
        await materialize((await dispatch(reassigned, deps, { outbox })).queued)
      }
      await db.insert(inboxItems).values({
        id: ITEM,
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceType: 'feedback',
        sourceId: randomUUID(),
        sourceDate: OCCURRED_AT,
        assignedTo: currentAssignee,
        commandRevision: currentAssignee === RECIPIENT ? 4 : 3,
      })

      await materialize((await dispatch(removal, deps, { outbox })).queued)

      const { notices, mail } = await stored()
      expect(notices.find(({ id }) => id === original!.id)).toMatchObject({
        resolvedAt: currentAssignee === RECIPIENT ? null : OCCURRED_AT,
      })
      expect(
        mail.find(({ notificationId }) => notificationId === original!.id),
      ).toMatchObject({
        status: currentAssignee === RECIPIENT ? 'pending' : 'cancelled',
      })
    },
  )
})
