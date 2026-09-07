import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { metricCurrentGoogleReputationSnapshots } from '#/shared/db/schema/metric.schema'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { VerifiedGoogleReputationSnapshotFact } from '../../application/ports/current-google-reputation-snapshot.port'
import {
  CURRENT_GOOGLE_REPUTATION_CONSUMER,
  createCurrentGoogleReputationSnapshotRepository,
} from './current-google-reputation-snapshot.repository'

const ORGANIZATION_ID = organizationId('metric-current-google-test-org')
const PROPERTY_ID = propertyId('56000000-0000-4000-8000-000000000001')
const EVENT_1 = '56000000-0000-4000-8000-000000000002'
const EVENT_2 = '56000000-0000-4000-8000-000000000003'
const EVENT_3 = '56000000-0000-4000-8000-000000000004'
const RUN_1 = '56000000-0000-4000-8000-000000000005'
const RUN_2 = '56000000-0000-4000-8000-000000000006'
const RUN_3 = '56000000-0000-4000-8000-000000000007'
const VERIFIED_AT = new Date('2026-08-28T05:00:00.000Z')

describe('Current on Google snapshot repository (real PostgreSQL)', () => {
  const db = getDb()
  const repository = createCurrentGoogleReputationSnapshotRepository(db)

  const clearFacts = async () => {
    await db
      .delete(metricCurrentGoogleReputationSnapshots)
      .where(eq(metricCurrentGoogleReputationSnapshots.propertyId, PROPERTY_ID))
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORGANIZATION_ID))
  }

  const recordSourceEvent = async (eventIdValue: string, runIdValue: string) => {
    await db.insert(outboxEvents).values({
      id: eventIdValue,
      eventType: 'review.google_reputation_snapshot.verified',
      eventVersion: 1,
      payload: {},
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceContext: 'review',
      sourceAggregateId: runIdValue,
    })
  }

  const fact = (
    overrides: Partial<VerifiedGoogleReputationSnapshotFact> = {},
  ): VerifiedGoogleReputationSnapshotFact => ({
    eventId: EVENT_1,
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    sourceEpoch: 1,
    runId: RUN_1,
    reviewCount: 12,
    averageRating: 4.6,
    evaluatedAt: VERIFIED_AT,
    ...overrides,
  })

  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (
        ${ORGANIZATION_ID},
        'Metric current Google test',
        ${ORGANIZATION_ID},
        transaction_timestamp()
      )
      ON CONFLICT (id) DO NOTHING
    `)
    await db
      .insert(properties)
      .values({
        id: PROPERTY_ID,
        organizationId: ORGANIZATION_ID,
        name: 'Metric current Google property',
        slug: 'metric-current-google-property',
        timezone: 'UTC',
        countryCode: 'US',
        profileVersion: 1,
        sourceEpoch: 1,
      })
      .onConflictDoNothing()
  })

  beforeEach(async () => {
    await clearFacts()
    await db
      .update(properties)
      .set({ sourceEpoch: 1 })
      .where(eq(properties.id, PROPERTY_ID))
  })

  afterAll(async () => {
    await clearFacts()
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
  })

  it('atomically applies once, receipts replay, and serves explicit semantics', async () => {
    await recordSourceEvent(EVENT_1, RUN_1)

    await expect(repository.applyVerifiedSnapshot(fact())).resolves.toBe('applied')
    await expect(repository.applyVerifiedSnapshot(fact())).resolves.toBe('duplicate')
    await expect(
      repository.getCurrentOnGoogle(ORGANIZATION_ID, PROPERTY_ID),
    ).resolves.toEqual({
      semantics: 'current_on_google',
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewCount: 12,
      averageRating: 4.6,
      verifiedAt: VERIFIED_AT,
    })

    const receipts = await db
      .select()
      .from(eventConsumerReceipts)
      .where(
        and(
          eq(eventConsumerReceipts.eventId, EVENT_1),
          eq(eventConsumerReceipts.consumerName, CURRENT_GOOGLE_REPUTATION_CONSUMER),
        ),
      )
    expect(receipts).toHaveLength(1)
    expect(receipts[0]?.status).toBe('applied')
  })

  it('receipts stale facts, rejects future epochs, and hides a prior source epoch', async () => {
    await recordSourceEvent(EVENT_1, RUN_1)
    await recordSourceEvent(EVENT_2, RUN_2)
    await recordSourceEvent(EVENT_3, RUN_3)
    await repository.applyVerifiedSnapshot(fact())

    await expect(
      repository.applyVerifiedSnapshot(
        fact({
          eventId: EVENT_2,
          runId: RUN_2,
          evaluatedAt: new Date(VERIFIED_AT.getTime() - 1),
        }),
      ),
    ).resolves.toBe('obsolete')
    await db
      .update(properties)
      .set({ sourceEpoch: 2 })
      .where(eq(properties.id, PROPERTY_ID))
    await expect(
      repository.getCurrentOnGoogle(ORGANIZATION_ID, PROPERTY_ID),
    ).resolves.toBeNull()
    await expect(
      repository.applyVerifiedSnapshot(
        fact({ eventId: EVENT_3, runId: RUN_3, sourceEpoch: 3 }),
      ),
    ).rejects.toThrow('ahead of Property')
    const futureReceipt = await db
      .select()
      .from(eventConsumerReceipts)
      .where(eq(eventConsumerReceipts.eventId, EVENT_3))
    expect(futureReceipt).toHaveLength(0)

    await expect(
      repository.applyVerifiedSnapshot(
        fact({
          eventId: EVENT_3,
          runId: RUN_3,
          sourceEpoch: 2,
          reviewCount: 0,
          averageRating: null,
          evaluatedAt: new Date(VERIFIED_AT.getTime() - 10_000),
        }),
      ),
    ).resolves.toBe('applied')
    await expect(
      repository.getCurrentOnGoogle(ORGANIZATION_ID, PROPERTY_ID),
    ).resolves.toMatchObject({ reviewCount: 0, averageRating: null })
  })

  it('rolls the receipt back when the projection write fails', async () => {
    await recordSourceEvent(EVENT_1, RUN_1)
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION reject_current_google_snapshot_test()
      RETURNS trigger LANGUAGE plpgsql AS $function$
      BEGIN
        RAISE EXCEPTION 'forced current Google projection rollback';
      END;
      $function$;
      CREATE TRIGGER reject_current_google_snapshot_test
      BEFORE INSERT ON metric_current_google_reputation_snapshots
      FOR EACH ROW EXECUTE FUNCTION reject_current_google_snapshot_test();
    `)
    try {
      await expect(repository.applyVerifiedSnapshot(fact())).rejects.toThrow(
        /Failed query/u,
      )
    } finally {
      await db.execute(sql`
        DROP TRIGGER IF EXISTS reject_current_google_snapshot_test
          ON metric_current_google_reputation_snapshots;
        DROP FUNCTION IF EXISTS reject_current_google_snapshot_test();
      `)
    }

    const receipt = await db
      .select()
      .from(eventConsumerReceipts)
      .where(eq(eventConsumerReceipts.eventId, EVENT_1))
    const projection = await db
      .select()
      .from(metricCurrentGoogleReputationSnapshots)
      .where(eq(metricCurrentGoogleReputationSnapshots.propertyId, PROPERTY_ID))
    expect(receipt).toHaveLength(0)
    expect(projection).toHaveLength(0)
  })
})
