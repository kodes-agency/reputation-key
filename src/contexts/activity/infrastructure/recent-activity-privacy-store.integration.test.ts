import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { asc, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import {
  recentActivityEntries,
  recentActivityActorLabelRedactions,
  recentActivityReplayFacts,
} from '#/shared/db/schema/activity.schema'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import {
  recentActivityEntryId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { RecentActivityEntry } from '../domain/types'
import type { ProjectableRecentActivityReplayFact } from '../domain/recent-activity-replay-fact'
import { recoverRecentActivity } from '../application/use-cases/recover-recent-activity'
import {
  createActivityDeliveryStore,
  valuesForReplayFact,
} from './activity-delivery-store'
import { createActivityRecoveryStore } from './activity-recovery-store'
import { createRecentActivityPrivacyStore } from './recent-activity-privacy-store'

let lease: TestLease
let db: Database

const ORG = organizationId('activity-privacy-integration')
const ACTOR = userId('activity-private-actor')
const PROPERTY = propertyId('00000000-0000-4000-8000-000000000a01')
const REDACTED_AT = new Date('2026-08-28T15:00:00.000Z')
const EXPIRES_AT = new Date('2026-11-26T15:00:00.000Z')

const replayFact = (index: 1 | 2 | 3): ProjectableRecentActivityReplayFact => ({
  replayKey: `event:${ORG as string}:00000000-0000-4000-8000-000000000a1${index}`,
  sourceKind: 'durable_fact',
  sourceEventId: `00000000-0000-4000-8000-000000000a1${index}`,
  sourceEventType: 'property.updated',
  sourceEventVersion: 1,
  sourceContext: 'property',
  sourceAggregateId: PROPERTY as string,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceOccurredAt: new Date(`2026-08-28T14:0${index}:00.000Z`),
  disposition: 'projectable',
  projectionId: recentActivityEntryId(`00000000-0000-4000-8000-000000000a2${index}`),
  actorSubjectId: ACTOR,
  actorLabelRedactedAt: null,
  action: 'changed',
  resourceType: 'property',
  resourceId: PROPERTY as string,
  payload: { subject: 'property', from: null, to: null, detail: null },
  source: 'web',
})

const entry = (fact: ProjectableRecentActivityReplayFact): RecentActivityEntry => ({
  id: fact.projectionId,
  actorId: ACTOR,
  actorName: 'Person who must disappear',
  actorAvatarUrl: 'https://cdn.example.test/private.png',
  actorRole: 'PropertyManager',
  action: fact.action,
  resourceType: fact.resourceType,
  resourceId: fact.resourceId,
  propertyId: fact.propertyId,
  organizationId: fact.organizationId,
  payload: fact.payload,
  source: fact.source,
  eventId: fact.sourceEventId,
  createdAt: fact.sourceOccurredAt,
})

const cleanup = async () => {
  await db
    .delete(recentActivityEntries)
    .where(eq(recentActivityEntries.organizationId, ORG))
  await db
    .delete(recentActivityReplayFacts)
    .where(eq(recentActivityReplayFacts.organizationId, ORG))
  await db
    .delete(recentActivityActorLabelRedactions)
    .where(eq(recentActivityActorLabelRedactions.organizationId, ORG))
  await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
})

beforeEach(cleanup)

afterAll(async () => {
  await cleanup()
  await lease.release()
})

describe('Recent Activity actor-label privacy (real PostgreSQL)', () => {
  it('redacts projection and replay authority in bounded batches, then rebuilds safely', async () => {
    const facts = [replayFact(1), replayFact(2)]
    await db.insert(recentActivityReplayFacts).values(facts.map(valuesForReplayFact))
    await db.insert(recentActivityEntries).values(
      facts.map((fact) => ({
        ...entry(fact),
        id: fact.projectionId as string,
        actorId: ACTOR as string,
        propertyId: PROPERTY as string,
        organizationId: ORG as string,
      })),
    )
    const store = createRecentActivityPrivacyStore(db)

    await expect(
      store.redactActorLabels({
        organizationId: ORG,
        actorSubjectId: ACTOR,
        redactedAt: REDACTED_AT,
        expiresAt: EXPIRES_AT,
        limit: 1,
      }),
    ).resolves.toEqual({ redacted: 1, remaining: true })
    await expect(
      store.redactActorLabels({
        organizationId: ORG,
        actorSubjectId: ACTOR,
        redactedAt: REDACTED_AT,
        expiresAt: EXPIRES_AT,
        limit: 1,
      }),
    ).resolves.toEqual({ redacted: 1, remaining: false })

    expect(
      await db
        .select({
          actorId: recentActivityEntries.actorId,
          actorName: recentActivityEntries.actorName,
          actorAvatarUrl: recentActivityEntries.actorAvatarUrl,
        })
        .from(recentActivityEntries)
        .where(eq(recentActivityEntries.organizationId, ORG))
        .orderBy(asc(recentActivityEntries.createdAt)),
    ).toEqual([
      { actorId: 'system', actorName: 'Former member', actorAvatarUrl: null },
      { actorId: 'system', actorName: 'Former member', actorAvatarUrl: null },
    ])

    await db
      .delete(recentActivityEntries)
      .where(eq(recentActivityEntries.organizationId, ORG))
    const recoveryStore = createActivityRecoveryStore(db)
    const userLookup = { lookup: vi.fn() }
    await recoverRecentActivity({
      store: recoveryStore,
      userLookup,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      },
    })({ observedAt: new Date('2026-08-28T15:01:00.000Z') })
    expect(userLookup.lookup).not.toHaveBeenCalled()
    expect(
      await db
        .select({ actorName: recentActivityEntries.actorName })
        .from(recentActivityEntries)
        .where(eq(recentActivityEntries.organizationId, ORG)),
    ).toEqual([{ actorName: 'Former member' }, { actorName: 'Former member' }])
  })

  it('fences a delayed durable delivery that arrives after redaction', async () => {
    const fact = replayFact(3)
    await db.insert(outboxEvents).values({
      id: fact.sourceEventId!,
      eventType: fact.sourceEventType!,
      eventVersion: fact.sourceEventVersion!,
      payload: {},
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceContext: 'property',
      sourceAggregateId: PROPERTY,
    })
    await createRecentActivityPrivacyStore(db).redactActorLabels({
      organizationId: ORG,
      actorSubjectId: ACTOR,
      redactedAt: REDACTED_AT,
      expiresAt: EXPIRES_AT,
      limit: 100,
    })

    await createActivityDeliveryStore(db).applyOnce({
      entry: entry(fact),
      replayFact: fact,
      eventId: fact.sourceEventId!,
      consumerName: 'activity.recent-activity',
    })

    expect(
      await db
        .select({
          actorName: recentActivityEntries.actorName,
          actorSubjectId: recentActivityReplayFacts.actorSubjectId,
          actorLabelRedactedAt: recentActivityReplayFacts.actorLabelRedactedAt,
        })
        .from(recentActivityEntries)
        .innerJoin(
          recentActivityReplayFacts,
          eq(recentActivityEntries.id, recentActivityReplayFacts.projectionId),
        )
        .where(eq(recentActivityEntries.organizationId, ORG)),
    ).toEqual([
      {
        actorName: 'Former member',
        actorSubjectId: null,
        actorLabelRedactedAt: REDACTED_AT,
      },
    ])
    expect(
      await db
        .select({ eventId: eventConsumerReceipts.eventId })
        .from(eventConsumerReceipts)
        .where(eq(eventConsumerReceipts.eventId, fact.sourceEventId!)),
    ).toEqual([{ eventId: fact.sourceEventId }])
  })
})
