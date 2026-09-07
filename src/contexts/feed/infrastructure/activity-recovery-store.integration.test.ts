import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { asc, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import {
  recentActivityEntries,
  recentActivityReplayFacts,
} from '#/shared/db/schema/activity.schema'
import {
  recentActivityEntryId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { ProjectableRecentActivityReplayFact } from '../domain/recent-activity-replay-fact'
import { recoverRecentActivity } from '../application/use-cases/recover-recent-activity'
import { createActivityRecoveryStore } from './activity-recovery-store'
import { valuesForReplayFact } from './activity-delivery-store'

let lease: TestLease
let db: Database

const ORG = organizationId('activity-recovery-integration')
const OBSERVED_AT = new Date('2026-08-28T12:00:00.000Z')

const replayFact = (
  index: 1 | 2,
  sourceOccurredAt: Date,
): ProjectableRecentActivityReplayFact => ({
  replayKey: `event:${ORG as string}:00000000-0000-4000-8000-00000000090${index}`,
  sourceKind: 'durable_fact',
  sourceEventId: `00000000-0000-4000-8000-00000000090${index}`,
  sourceEventType: index === 1 ? 'property.archived' : 'property.restored',
  sourceEventVersion: 1,
  sourceContext: 'property',
  sourceAggregateId: '00000000-0000-4000-8000-000000000910',
  organizationId: ORG,
  propertyId: propertyId('00000000-0000-4000-8000-000000000910'),
  sourceOccurredAt,
  disposition: 'projectable',
  projectionId: recentActivityEntryId(`00000000-0000-4000-8000-00000000092${index}`),
  actorSubjectId: userId('activity-recovery-user'),
  actorLabelRedactedAt: null,
  action: 'changed',
  resourceType: 'property',
  resourceId: '00000000-0000-4000-8000-000000000910',
  payload: {
    subject: 'property',
    from: index === 1 ? 'active' : 'archived',
    to: index === 1 ? 'archived' : 'active',
    detail: null,
  },
  source: 'web',
})

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
})

afterAll(async () => {
  await db
    .delete(recentActivityEntries)
    .where(eq(recentActivityEntries.organizationId, ORG))
  await db
    .delete(recentActivityReplayFacts)
    .where(eq(recentActivityReplayFacts.organizationId, ORG))
  await lease.release()
})

describe('Activity recovery store (real PostgreSQL)', () => {
  it('rebuilds an empty retained projection to canonical identifier-only parity', async () => {
    const facts = [
      replayFact(1, new Date('2026-08-28T11:57:00.000Z')),
      replayFact(2, new Date('2026-08-28T11:58:00.000Z')),
    ]
    await db.insert(recentActivityReplayFacts).values(facts.map(valuesForReplayFact))
    const store = createActivityRecoveryStore(db)
    const recover = recoverRecentActivity({
      store,
      userLookup: {
        lookup: vi.fn(async () => ({
          name: 'Current actor label',
          avatarUrl: null,
          role: 'PropertyManager' as const,
          rawRole: 'PropertyManager',
        })),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      },
    })

    await expect(recover({ observedAt: OBSERVED_AT, limit: 1 })).resolves.toMatchObject({
      processed: 1,
      complete: false,
    })
    await expect(recover({ observedAt: OBSERVED_AT })).resolves.toMatchObject({
      processed: 1,
      complete: true,
    })
    const firstProjection = await db
      .select({
        id: recentActivityEntries.id,
        eventId: recentActivityEntries.eventId,
        action: recentActivityEntries.action,
        resourceType: recentActivityEntries.resourceType,
        resourceId: recentActivityEntries.resourceId,
        organizationId: recentActivityEntries.organizationId,
        propertyId: recentActivityEntries.propertyId,
        payload: recentActivityEntries.payload,
        source: recentActivityEntries.source,
        createdAt: recentActivityEntries.createdAt,
      })
      .from(recentActivityEntries)
      .where(eq(recentActivityEntries.organizationId, ORG))
      .orderBy(asc(recentActivityEntries.createdAt))
    expect(firstProjection).toHaveLength(2)
    await expect(store.readGap({ observedAt: OBSERVED_AT })).resolves.toMatchObject({
      missingCount: 0,
      replayFactCount: 2,
    })

    await db
      .delete(recentActivityEntries)
      .where(eq(recentActivityEntries.organizationId, ORG))
    await expect(recover({ observedAt: OBSERVED_AT })).resolves.toMatchObject({
      processed: 2,
      complete: true,
    })
    const rebuiltProjection = await db
      .select({
        id: recentActivityEntries.id,
        eventId: recentActivityEntries.eventId,
        action: recentActivityEntries.action,
        resourceType: recentActivityEntries.resourceType,
        resourceId: recentActivityEntries.resourceId,
        organizationId: recentActivityEntries.organizationId,
        propertyId: recentActivityEntries.propertyId,
        payload: recentActivityEntries.payload,
        source: recentActivityEntries.source,
        createdAt: recentActivityEntries.createdAt,
      })
      .from(recentActivityEntries)
      .where(eq(recentActivityEntries.organizationId, ORG))
      .orderBy(asc(recentActivityEntries.createdAt))
    expect(rebuiltProjection).toEqual(firstProjection)
  })
})
