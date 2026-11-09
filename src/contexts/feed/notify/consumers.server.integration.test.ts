// The account, integration, Portal and Property routes, from their real
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

describe.sequential('account, integration, Portal and Property notices', () => {
  let lease: TestLease
  let db: Database

  type WriterOverrides = Partial<
    Pick<Parameters<typeof createNoticeWriter>[0], 'authorizeAudience' | 'workState'>
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
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({ BETA_ALLOWLIST_ORGS: ORG }),
    )
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
      eventType: 'identity.organization_lifecycle.changed',
      consumerName: 'notification.on-identity-organization-purge-pending',
      type: 'account.organization_purge_pending',
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
  ] as const

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
      expect(stored.map(({ type }) => type)).toEqual([route.type])
      expect(await receiptsOf(fact.eventId, route.consumerName)).toHaveLength(1)

      await dispatch(fact, routeDeps(), { outbox, envelope })
      const again = await noticesOf(fact.eventId, route.type)
      expect(again).toHaveLength(1)
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

      await dispatch(fact, routeDeps(), { outbox: createOutboxRepository(db), envelope })
      expect(await noticesOf(fact.eventId, route.type)).toHaveLength(1)
      expect(await receiptsOf(fact.eventId, route.consumerName)).toHaveLength(1)
    })
  }
})
