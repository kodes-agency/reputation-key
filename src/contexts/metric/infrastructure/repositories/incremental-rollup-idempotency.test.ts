// BQC-5.10 row 7 (Metric) — incremental rollup idempotency pin (real Postgres).
//
// The acceptance matrix claims the daily metric rollup is idempotent:
// partition DELETE+INSERT recomputation from the same watermark reproduces
// byte-identical rollup contents, and the watermark lands on the same value.
// Both runs execute inside ONE transaction so pg now() is stable across them
// (transaction timestamp) — the watermark equality is exact, not approximate.
// A rollback sentinel unwinds the transaction at the end, leaving zero
// residue (seeded org/property/readings, rollup rows, watermark) in the
// shared test database.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb, type Database } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema/metric.schema'
import { refreshDailyMetricsIncrementally } from '../incremental-rollup'
import { createMockLogger } from '#/shared/testing/mock-logger'

const ORG = 'org-rollup-idem-0000-0001'
const PROP = '4f000000-0000-0000-0000-000000000001'
const NULL_PORTAL = '00000000-0000-0000-0000-000000000000'
const EPOCH = new Date('1970-01-01T00:00:00.000Z')
const RECORDED_DAY = '2026-06-01T00:00:00.000Z'

class RollbackSentinel extends Error {}

type RollupRow = Readonly<{
  organization_id: string
  property_id: string
  portal_id: string
  metric_key: string
  date: string
  count: number
  sum_value: number
  avg_value: number
}>

type Run = Readonly<{ recomputed: number; rows: RollupRow[]; watermark: string }>
type Snapshot = Readonly<{ first: Run; second: Run; third: Run }>

async function seed(db: Database): Promise<void> {
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Rollup Idem Org', 'rollup-idem-org', now())
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
    VALUES (${PROP}, ${ORG}, 'Rollup Idem Property', 'rollup-idem-prop', 'UTC', now(), now())
    ON CONFLICT (id) DO NOTHING
  `)
  await db.insert(metricReadings).values([
    {
      organizationId: ORG,
      propertyId: PROP,
      portalId: null,
      groupId: null,
      metricKey: 'property.review',
      value: 4,
      occurredAt: new Date('2026-06-01T12:00:00.000Z'),
    },
    {
      organizationId: ORG,
      propertyId: PROP,
      portalId: null,
      groupId: null,
      metricKey: 'property.review',
      value: 5,
      occurredAt: new Date('2026-06-01T13:00:00.000Z'),
    },
    {
      organizationId: ORG,
      propertyId: PROP,
      portalId: null,
      groupId: null,
      metricKey: 'portal.scan',
      value: 1,
      occurredAt: new Date('2026-06-01T14:00:00.000Z'),
    },
  ])
}

async function setWatermark(db: Database, at: Date): Promise<void> {
  await db.execute(sql`
    INSERT INTO _rollup_watermarks (name, watermark, updated_at)
    VALUES ('daily_metrics', ${at}, now())
    ON CONFLICT (name) DO UPDATE SET watermark = EXCLUDED.watermark, updated_at = now()
  `)
}

async function readWatermark(db: Database): Promise<string> {
  const result = await db.execute(
    sql`SELECT watermark FROM _rollup_watermarks WHERE name = 'daily_metrics'`,
  )
  const row = result.rows[0] as { watermark: Date | string } | undefined
  if (!row) throw new Error('daily_metrics watermark row missing')
  return new Date(row.watermark).toISOString()
}

async function snapshotRows(db: Database): Promise<RollupRow[]> {
  const result = await db.execute(sql`
    SELECT organization_id, property_id, portal_id, metric_key, date, count, sum_value, avg_value
    FROM rollup_daily_metrics
    ORDER BY organization_id, property_id, portal_id, metric_key, date
  `)
  return result.rows.map((r) => {
    const row = r as Record<string, unknown>
    return {
      organization_id: row.organization_id as string,
      property_id: row.property_id as string,
      portal_id: row.portal_id as string,
      metric_key: row.metric_key as string,
      // pg returns timestamptz as Date or string depending on driver path — normalize.
      date: new Date(row.date as string | Date).toISOString(),
      count: row.count as number,
      sum_value: row.sum_value as number,
      avg_value: row.avg_value as number,
    }
  })
}

async function runOnce(db: Database): Promise<Run> {
  const { partitionsRecomputed } = await refreshDailyMetricsIncrementally(
    db,
    createMockLogger(),
  )
  return {
    recomputed: partitionsRecomputed,
    rows: await snapshotRows(db),
    watermark: await readWatermark(db),
  }
}

async function exercise(db: Database): Promise<Snapshot> {
  // date_trunc uses the session timezone — pin it so day boundaries are
  // deterministic regardless of the host's Postgres timezone setting.
  await db.execute(sql`SET LOCAL timezone = 'UTC'`)
  await seed(db)
  await setWatermark(db, EPOCH)
  const first = await runOnce(db)
  // Rewind to the same starting watermark — run 2 recomputes the same partitions.
  await setWatermark(db, EPOCH)
  const second = await runOnce(db)
  // No rewind — the watermark gate must no-op.
  const third = await runOnce(db)
  return { first, second, third }
}

async function runRolledBack(db: Database): Promise<Snapshot> {
  let snapshot: Snapshot | undefined
  await db
    .transaction(async (tx) => {
      // The refresh path uses only `.execute`, which the transaction client
      // satisfies — the cast is the test seam into the production signature.
      snapshot = await exercise(tx as unknown as Database)
      throw new RollbackSentinel()
    })
    .catch((err: unknown) => {
      if (!(err instanceof RollbackSentinel)) throw err
    })
  if (!snapshot) throw new Error('rollup exercise produced no snapshot')
  return snapshot
}

describe('BQC-5.10 metric incremental rollup idempotency (integration)', () => {
  it('re-running from the same watermark reproduces identical contents and watermark', async () => {
    const db = getDb()
    const snap = await runRolledBack(db)

    // Both runs recomputed exactly the affected partitions.
    expect(snap.first.recomputed).toBe(1)
    expect(snap.second.recomputed).toBe(1)

    // Vacuity guard — the seeded aggregates really landed.
    const mine = snap.first.rows.filter((r) => r.organization_id === ORG)
    expect(mine).toEqual([
      {
        organization_id: ORG,
        property_id: PROP,
        portal_id: NULL_PORTAL,
        metric_key: 'portal.scan',
        date: RECORDED_DAY,
        count: 1,
        sum_value: 1,
        avg_value: 1,
      },
      {
        organization_id: ORG,
        property_id: PROP,
        portal_id: NULL_PORTAL,
        metric_key: 'property.review',
        date: RECORDED_DAY,
        count: 2,
        sum_value: 9,
        avg_value: 4.5,
      },
    ])

    // Idempotency: same watermark → identical rollup contents + identical watermark.
    expect(snap.second.rows).toEqual(snap.first.rows)
    expect(snap.second.watermark).toBe(snap.first.watermark)

    // No new data since the watermark → no-op; contents unchanged.
    expect(snap.third.recomputed).toBe(0)
    expect(snap.third.rows).toEqual(snap.first.rows)

    // The rollback sentinel leaves nothing behind in the shared test database.
    const residue = await db.execute(
      sql`SELECT count(*)::int AS n FROM metric_readings WHERE organization_id = ${ORG}`,
    )
    expect(residue.rows[0]).toMatchObject({ n: 0 })
  })
})
