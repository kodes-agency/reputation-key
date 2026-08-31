import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import {
  recentActivityEntries,
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
import { createActivityDeliveryStore } from './activity-delivery-store'

let lease: TestLease
let db: Database

const SOURCE_EVENT_ID = '00000000-0000-4000-8000-000000000501'
const MISSING_EVENT_ID = '00000000-0000-4000-8000-000000000502'
const ORG_ID = organizationId('activity-delivery-org')

const entry = (eventId: string, createdAt: Date): RecentActivityEntry => ({
  id: recentActivityEntryId('00000000-0000-4000-8000-000000000503'),
  actorId: userId('system'),
  actorName: 'System',
  actorAvatarUrl: null,
  actorRole: 'Staff',
  action: 'created',
  resourceType: 'property',
  resourceId: '00000000-0000-4000-8000-000000000504',
  propertyId: propertyId('00000000-0000-4000-8000-000000000504'),
  organizationId: ORG_ID,
  payload: { subject: 'property', from: null, to: null, detail: null },
  source: 'web',
  eventId,
  createdAt,
})

const replayFact = (
  eventId: string,
  createdAt: Date,
): ProjectableRecentActivityReplayFact => ({
  replayKey: `event:${ORG_ID as string}:${eventId}`,
  sourceKind: 'durable_fact',
  sourceEventId: eventId,
  sourceEventType: 'property.created',
  sourceEventVersion: 1,
  sourceContext: 'property',
  sourceAggregateId: 'property-1',
  organizationId: ORG_ID,
  propertyId: propertyId('00000000-0000-4000-8000-000000000504'),
  sourceOccurredAt: createdAt,
  disposition: 'projectable',
  projectionId: recentActivityEntryId('00000000-0000-4000-8000-000000000503'),
  actorSubjectId: null,
  actorLabelRedactedAt: null,
  action: 'created',
  resourceType: 'property',
  resourceId: '00000000-0000-4000-8000-000000000504',
  payload: { subject: 'property', from: null, to: null, detail: null },
  source: 'web',
})

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
})

afterAll(async () => {
  await db
    .delete(recentActivityEntries)
    .where(eq(recentActivityEntries.organizationId, ORG_ID))
  await db
    .delete(recentActivityReplayFacts)
    .where(eq(recentActivityReplayFacts.organizationId, ORG_ID))
  await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG_ID))
  await lease.release()
})

beforeEach(async () => {
  await db
    .delete(recentActivityEntries)
    .where(eq(recentActivityEntries.organizationId, ORG_ID))
  await db
    .delete(recentActivityReplayFacts)
    .where(eq(recentActivityReplayFacts.organizationId, ORG_ID))
  await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG_ID))
  await db.insert(outboxEvents).values({
    id: SOURCE_EVENT_ID,
    eventType: 'property.created',
    eventVersion: 1,
    payload: {},
    organizationId: ORG_ID,
    propertyId: null,
    sourceContext: 'property',
    sourceAggregateId: 'property-1',
  })
})

describe('Activity delivery store (real PostgreSQL)', () => {
  it('co-commits one projection and its durable delivery receipt', async () => {
    const store = createActivityDeliveryStore(db)
    const result = await store.applyOnce({
      entry: entry(SOURCE_EVENT_ID, new Date('2026-08-28T08:00:00.000Z')),
      replayFact: replayFact(SOURCE_EVENT_ID, new Date('2026-08-28T08:00:00.000Z')),
      eventId: SOURCE_EVENT_ID,
      consumerName: 'activity.recent-activity',
    })

    expect(result).toBe('applied')
    expect(
      await db
        .select({ eventId: recentActivityEntries.eventId })
        .from(recentActivityEntries)
        .where(eq(recentActivityEntries.eventId, SOURCE_EVENT_ID)),
    ).toEqual([{ eventId: SOURCE_EVENT_ID }])
    expect(
      await db
        .select({ status: eventConsumerReceipts.status })
        .from(eventConsumerReceipts)
        .where(eq(eventConsumerReceipts.eventId, SOURCE_EVENT_ID)),
    ).toEqual([{ status: 'applied' }])
    expect(
      await db
        .select({ sourceEventId: recentActivityReplayFacts.sourceEventId })
        .from(recentActivityReplayFacts)
        .where(eq(recentActivityReplayFacts.sourceEventId, SOURCE_EVENT_ID)),
    ).toEqual([{ sourceEventId: SOURCE_EVENT_ID }])
  })

  it('rolls back the projection when the receipt cannot commit', async () => {
    const store = createActivityDeliveryStore(db)

    await expect(
      store.applyOnce({
        entry: entry(MISSING_EVENT_ID, new Date('2026-08-28T08:01:00.000Z')),
        replayFact: replayFact(MISSING_EVENT_ID, new Date('2026-08-28T08:01:00.000Z')),
        eventId: MISSING_EVENT_ID,
        consumerName: 'activity.recent-activity',
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } })

    expect(
      await db
        .select({ eventId: recentActivityEntries.eventId })
        .from(recentActivityEntries)
        .where(eq(recentActivityEntries.eventId, MISSING_EVENT_ID)),
    ).toEqual([])
    expect(
      await db
        .select({ sourceEventId: recentActivityReplayFacts.sourceEventId })
        .from(recentActivityReplayFacts)
        .where(eq(recentActivityReplayFacts.sourceEventId, MISSING_EVENT_ID)),
    ).toEqual([])
  })

  it('repairs a bus-first row and records a duplicate receipt without a second row', async () => {
    const store = createActivityDeliveryStore(db)
    await db
      .insert(recentActivityEntries)
      .values({
        ...entry(SOURCE_EVENT_ID, new Date('2026-08-28T08:05:00.000Z')),
        id: '00000000-0000-4000-8000-000000000505',
        actorId: 'system',
        propertyId: '00000000-0000-4000-8000-000000000504',
        organizationId: ORG_ID,
      })
      .onConflictDoNothing()
    await db
      .delete(eventConsumerReceipts)
      .where(eq(eventConsumerReceipts.eventId, SOURCE_EVENT_ID))

    const result = await store.applyOnce({
      entry: entry(SOURCE_EVENT_ID, new Date('2026-08-28T07:59:00.000Z')),
      replayFact: replayFact(SOURCE_EVENT_ID, new Date('2026-08-28T07:59:00.000Z')),
      eventId: SOURCE_EVENT_ID,
      consumerName: 'activity.recent-activity',
    })

    const rows = await db
      .select({ createdAt: recentActivityEntries.createdAt })
      .from(recentActivityEntries)
      .where(eq(recentActivityEntries.eventId, SOURCE_EVENT_ID))
    expect(result).toBe('duplicate')
    expect(rows).toEqual([{ createdAt: new Date('2026-08-28T07:59:00.000Z') }])
    expect(
      await db
        .select({ status: eventConsumerReceipts.status })
        .from(eventConsumerReceipts)
        .where(eq(eventConsumerReceipts.eventId, SOURCE_EVENT_ID)),
    ).toEqual([{ status: 'duplicate' }])
  })
})
