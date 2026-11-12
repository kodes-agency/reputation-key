// The account, integration, Portal, Property, Inbox, reply, goal and AI routes, from their real
// producers through the dispatcher into PostgreSQL.
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
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
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  eventConsumerReceipts,
  notificationEmailQueue,
  notificationPreferences,
  notifications,
  outboxEvents,
  properties,
} from '#/shared/db/schema'
import { notificationEmailId, notificationId } from '#/shared/domain/ids'
import type { DomainEvent } from '#/shared/events/events'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import { deleteTestOrganizations, seedOrgs } from '#/shared/testing/integration-helpers'
import {
  ADMIN,
  PRODUCED_FACTS,
  ORG,
  PROPERTY,
} from '#/shared/testing/notification-route-producer-fixtures'
import {
  currentRouteDeps,
  dispatch,
  registerNotificationRoutes,
  type RouteDeps,
} from '#/shared/testing/notification-route-test-harness'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { waitingWorkState } from '../infrastructure/jobs/test-fixtures'
import { createNoticeWriter } from './consumers.server'

const NOW = new Date('2026-09-02T09:00:00.000Z')

describe.sequential(
  'account, integration, Portal, Property, Inbox, reply, goal and AI notices',
  () => {
    let lease: TestLease
    let db: Database

    type WriterOverrides = Partial<
      Pick<
        Parameters<typeof createNoticeWriter>[0],
        'authorizeAudience' | 'workState' | 'ratingForRouting'
      >
    >

    const writerDeps = (
      idGen: () => ReturnType<typeof notificationId>,
      overrides: WriterOverrides = {},
    ) => ({
      db,
      clock: () => NOW,
      idGen,
      emailIdGen: () => notificationEmailId(randomUUID()),
      logger: currentRouteDeps().logger as never,
      ratingForRouting: async () => null,
      authorizeAudience: async () => true as const,
      workState: waitingWorkState(),
      ...overrides,
    })

    const routeDeps = (
      idGen = () => notificationId(randomUUID()),
      overrides: WriterOverrides = {},
    ): RouteDeps =>
      ({
        ...currentRouteDeps(),
        noticeWriter: createNoticeWriter(writerDeps(idGen, overrides)),
      }) as RouteDeps

    async function produce(eventType: string) {
      const fact: DomainEvent = PRODUCED_FACTS[eventType]!()
      const [source] = await db
        .insert(outboxEvents)
        .values({ id: fact.eventId, ...toOutboxEvent(fact), createdAt: NOW })
        .returning()
      const envelope = buildConsumerEvent({ ...source!, recordedAt: source!.createdAt })
      return { fact, envelope }
    }

    const noticesOf = (eventId: string, type?: string) =>
      db
        .select()
        .from(notifications)
        .where(
          type === undefined
            ? eq(notifications.eventId, eventId)
            : and(eq(notifications.eventId, eventId), eq(notifications.type, type)),
        )

    const receiptsOf = (eventId: string, consumerName: string) =>
      db
        .select()
        .from(eventConsumerReceipts)
        .where(
          and(
            eq(eventConsumerReceipts.eventId, eventId),
            eq(eventConsumerReceipts.consumerName, consumerName),
          ),
        )

    async function clear() {
      await db
        .delete(notificationEmailQueue)
        .where(eq(notificationEmailQueue.organizationId, ORG))
      await db.delete(notifications).where(eq(notifications.organizationId, ORG))
      await db
        .delete(notificationPreferences)
        .where(eq(notificationPreferences.organizationId, ORG))
      await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
    }

    beforeAll(async () => {
      lease = await acquireTestLease(getEnv().DATABASE_URL)
      db = drizzle(lease.pool) as Database
      registerAllEventSchemas()
      await seedOrgs(lease.pool, [ORG])
      await db.insert(properties).values({
        id: PROPERTY,
        organizationId: ORG,
        name: 'Notice Property',
        slug: 'consumer-notices',
        timezone: 'UTC',
      })
    })
    beforeEach(async () => {
      await clear()
      // Guest voice is opt-in: the manager has asked for it.
      await db.insert(notificationPreferences).values({
        userId: ADMIN,
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'guest_voice',
        channel: 'in_app',
        enabled: true,
        cadence: 'immediate',
      })
      initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
      initDelayedExecutionPolicy(
        createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
      )
    })
    afterEach(() => {
      resetDelayedExecutionPolicy()
      resetCapabilityPolicyStore()
    })
    afterAll(async () => {
      try {
        if (db) {
          await clear()
          await db.delete(properties).where(eq(properties.organizationId, ORG))
        }
        if (lease) await deleteTestOrganizations(lease.pool, [ORG])
      } finally {
        await lease?.release()
      }
    })

    const ROUTES = [
      {
        eventType: 'identity.member.role_changed',
        consumerName: 'notification.on-identity-member-role-changed',
        type: 'account.organization_role_changed',
      },
      {
        eventType: 'integration.google_account.disconnected',
        consumerName: 'notification.on-google-account-disconnected',
        type: 'integration.google_disconnected',
      },
      {
        eventType: 'portal.responsibility_became_needed',
        consumerName: 'notification.on-portal-responsibility-needed',
        type: 'portal.responsibility_needed',
      },
      {
        eventType: 'property.responsibility_became_needed',
        consumerName: 'notification.on-property-responsibility-needed',
        type: 'property.responsibility_needed',
      },
      {
        eventType: 'identity.beta_feedback.outcome_reached',
        consumerName: 'notification.on-identity-beta-feedback-outcome',
        type: 'beta_feedback.outcome',
      },
      {
        eventType: 'identity.invitation.accepted',
        consumerName: 'notification.on-identity-invitation-accepted-inviter',
        type: 'account.invitation_accepted',
      },
      {
        eventType: 'integration.google_account.reauthorization_required',
        consumerName: 'notification.on-google-reauthorization-required',
        type: 'integration.reauthorization_required',
      },
      {
        eventType: 'goal.monthly_result.closed',
        consumerName: 'notification.on-goal-monthly-result-closed',
        type: 'goal.completed',
      },
      {
        eventType: 'goal.monthly_result.revised',
        consumerName: 'notification.on-goal-monthly-result-revised',
        type: 'goal.result_revised',
      },
      {
        eventType: 'goal.rating_goal.transitioned',
        consumerName: 'notification.on-rating-goal-transitioned',
        type: 'goal.rating_below_pace',
      },
      {
        eventType: 'ai.review_analysis.urgent_detected',
        consumerName: 'notification.on-ai-review-urgent-detected',
        type: 'review.ai_urgent_detected',
      },
      {
        eventType: 'ai.guest_voice_summary.ready',
        consumerName: 'notification.on-ai-guest-voice-summary-ready',
        type: 'guest_voice.summary',
      },
      {
        eventType: 'inbox.inbox_item.assigned',
        consumerName: 'notification.on-inbox-inbox_item-assigned',
        type: 'inbox.assigned',
      },
      {
        eventType: 'inbox.inbox_items.bulk_assignment_completed',
        consumerName: 'notification.on-inbox-bulk-assignment-completed',
        type: 'inbox.bulk_assigned',
      },
      {
        eventType: 'inbox.inbox_items.assignments_released',
        consumerName: 'notification.on-inbox-assignments-released',
        type: 'inbox.assignments_released',
      },
      {
        eventType: 'inbox.inbox_item.escalated',
        consumerName: 'notification.on-inbox-inbox_item-escalated',
        type: 'inbox.escalated',
      },
      {
        eventType: 'inbox.inbox_item.escalation_resolved',
        consumerName: 'notification.on-inbox-escalation-resolved',
        type: 'inbox.escalation_resolved',
      },
      {
        eventType: 'inbox.inbox_note.added',
        consumerName: 'notification.on-inbox-inbox_note-added',
        type: 'inbox_note.added',
      },
      {
        eventType: 'inbox.handling_cycle.reopened',
        consumerName: 'notification.on-inbox-handling-cycle-reopened',
        type: 'inbox.reopened',
      },
      {
        eventType: 'inbox.inbox_items.bulk_reopen_completed',
        consumerName: 'notification.on-inbox-bulk-reopen-completed',
        type: 'inbox.bulk_reopened',
      },
      {
        eventType: 'inbox.response_target.reminder_due',
        consumerName: 'notification.on-inbox-response-target-reminder-due',
        type: 'inbox.response_target_passed',
      },
      {
        eventType: 'review.reply.submitted',
        consumerName: 'notification.on-review-reply-submitted',
        type: 'reply.pending_approval',
      },
      {
        eventType: 'review.reply.approved',
        consumerName: 'notification.on-review-reply-approved',
        type: 'reply.approved',
      },
      {
        eventType: 'review.reply.rejected',
        consumerName: 'notification.on-review-reply-rejected',
        type: 'reply.rejected',
      },
      {
        eventType: 'review.reply.published',
        consumerName: 'notification.on-review-reply-published',
        type: 'reply.published',
      },
      {
        eventType: 'review.reply.publish_failed',
        consumerName: 'notification.on-review-reply-publish_failed',
        type: 'reply.publish_failed',
      },
      {
        eventType: 'review.reply.publication_cancelled',
        consumerName: 'notification.on-review-reply-publication_cancelled',
        type: 'reply.publication_cancelled',
      },
    ] as const

    /** Routes that tell more than one person under the same type. */
    const NOTICES_PER_FACT: Readonly<Record<string, number>> = {
      // The author, and the approvers who may approve it again.
      'review.reply.publication_cancelled': 2,
    }
    const noticeCount = (eventType: string) => NOTICES_PER_FACT[eventType] ?? 1

    const queuedEmailsOf = () =>
      db
        .select()
        .from(notificationEmailQueue)
        .where(eq(notificationEmailQueue.organizationId, ORG))

    const suppressions = {
      'a recipient no longer eligible': { authorizeAudience: async () => false as const },
      'work already done': {
        workState: {
          ...waitingWorkState(),
          isWaiting: async () => false as const,
        },
      },
    } satisfies Record<string, WriterOverrides>

    for (const route of ROUTES) {
      for (const [reason, overrides] of Object.entries(suppressions)) {
        it(`${route.eventType}: ${reason} writes no notice or email and settles obsolete`, async () => {
          const { fact, envelope } = await produce(route.eventType)
          const outbox = createOutboxRepository(db)

          const result = await dispatch(
            fact,
            routeDeps(undefined, overrides as WriterOverrides),
            { outbox, envelope },
          )

          expect(result.queued).toEqual([])
          expect(await noticesOf(fact.eventId, route.type)).toEqual([])
          expect(await queuedEmailsOf()).toEqual([])
          const receipts = await receiptsOf(fact.eventId, route.consumerName)
          expect(receipts.map(({ status }) => status)).toEqual(['obsolete'])
        })
      }

      it(`${route.eventType}: a grouped decision stores the count that still stood`, async () => {
        const { fact, envelope } = await produce(route.eventType)
        const registration = registerNotificationRoutes(
          routeDeps(undefined, { authorizeAudience: async () => ({ itemCount: 7 }) }),
        )
          .listFor(route.eventType)
          .find(({ consumerName }) => consumerName === route.consumerName)!

        await registration.handler(envelope)

        const [stored] = await noticesOf(fact.eventId, route.type)
        expect(stored?.payload).toMatchObject({ itemCount: 7 })
      })
    }

    for (const route of ROUTES) {
      it(`${route.eventType}: writes the notice and its receipt together, once`, async () => {
        const { fact, envelope } = await produce(route.eventType)
        const outbox = createOutboxRepository(db)

        const first = await dispatch(fact, routeDeps(), { outbox, envelope })
        expect(first.queued).toEqual([])
        expect(first.gateDenials).toEqual([])
        const stored = await noticesOf(fact.eventId, route.type)
        expect(stored.map(({ type }) => type)).toEqual(
          Array(noticeCount(route.eventType)).fill(route.type),
        )
        expect(await receiptsOf(fact.eventId, route.consumerName)).toHaveLength(1)

        await dispatch(fact, routeDeps(), { outbox, envelope })
        const again = await noticesOf(fact.eventId, route.type)
        expect(again).toHaveLength(noticeCount(route.eventType))
        expect(again[0]).toMatchObject({ id: stored[0]!.id, coalescedCount: 1 })
      })

      it(`${route.eventType}: a failed write leaves no receipt and redelivery completes it`, async () => {
        const { fact, envelope } = await produce(route.eventType)
        const failing = routeDeps(() => {
          throw new Error('id source failed')
        })
        const registration = registerNotificationRoutes(failing)
          .listFor(route.eventType)
          .find(({ consumerName }) => consumerName === route.consumerName)!

        await expect(registration.handler(envelope)).rejects.toThrow('id source failed')
        expect(await noticesOf(fact.eventId, route.type)).toEqual([])
        expect(await receiptsOf(fact.eventId, route.consumerName)).toEqual([])

        await dispatch(fact, routeDeps(), {
          outbox: createOutboxRepository(db),
          envelope,
        })
        expect(await noticesOf(fact.eventId, route.type)).toHaveLength(
          noticeCount(route.eventType),
        )
        expect(await receiptsOf(fact.eventId, route.consumerName)).toHaveLength(1)
      })
    }

    // A new review and a guest's edit are arrivals, off in the app by default; a
    // rating at or below the reader's Low ratings threshold lifts them in.
    for (const arrival of [
      {
        eventType: 'inbox.inbox_item.created',
        consumerName: 'notification.on-inbox-item-created',
        type: 'review.created',
      },
      {
        eventType: 'inbox.handling_cycle.opened',
        consumerName: 'notification.on-inbox-handling-cycle-opened',
        type: 'review.updated',
      },
    ] as const) {
      it(`${arrival.eventType}: a low rating reaches the bell, a high one stays an arrival`, async () => {
        const outbox = createOutboxRepository(db)

        const low = await produce(arrival.eventType)
        await dispatch(
          low.fact,
          routeDeps(undefined, { ratingForRouting: async () => 1 }),
          {
            outbox,
            envelope: low.envelope,
          },
        )
        expect(
          (await noticesOf(low.fact.eventId, arrival.type)).map(({ type }) => type),
        ).toEqual([arrival.type])
        expect(await receiptsOf(low.fact.eventId, arrival.consumerName)).toHaveLength(1)

        const high = await produce(arrival.eventType)
        await dispatch(
          high.fact,
          routeDeps(undefined, { ratingForRouting: async () => 5 }),
          {
            outbox,
            envelope: high.envelope,
          },
        )
        expect(await noticesOf(high.fact.eventId, arrival.type)).toEqual([])
        const receipts = await receiptsOf(high.fact.eventId, arrival.consumerName)
        expect(receipts.map(({ status }) => status)).toEqual(['applied'])
      })
    }

    it('inbox.inbox_item.assigned: an assignee the item has moved on from is not told, the previous holder still is', async () => {
      const { fact, envelope } = await produce('inbox.inbox_item.assigned')

      await dispatch(
        fact,
        routeDeps(undefined, {
          // The item no longer belongs to the assignee the fact names.
          authorizeAudience: async ({ audience }) => audience.kind !== 'inbox_assignee',
        }),
        { outbox: createOutboxRepository(db), envelope },
      )

      expect(await noticesOf(fact.eventId, 'inbox.assigned')).toEqual([])
      expect(
        (await noticesOf(fact.eventId, 'inbox.unassigned')).map(({ type }) => type),
      ).toEqual(['inbox.unassigned'])
    })
  },
)
