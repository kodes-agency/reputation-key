// Reporting readings are deleted 24 calendar months after they were recorded,
// together with their corrections, against real PostgreSQL. Old, boundary and
// current readings, a correction chain, resume after a capped run and a second
// tenant that the first tenant's run must not touch.

import type { Job } from 'bullmq'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { createRetentionSweepHandler, RETENTION_RULES } from './retention-sweep.job'

const ORG_A = 'readings-retention-org-a'
const ORG_B = 'readings-retention-org-b'
const RUN_AT = new Date('2026-11-08T12:00:00.000Z')
const OLD = new Date('2024-01-15T00:00:00.000Z')
const JUST_PAST = new Date('2024-11-08T11:59:59.000Z')
const AT_BOUNDARY = new Date('2024-11-08T12:00:00.000Z')
const CURRENT = new Date('2026-10-01T00:00:00.000Z')

const db = getDb()
const PROPERTIES: Readonly<Record<string, string>> = {
  [ORG_A]: '7a400000-0000-4000-8000-00000000000a',
  [ORG_B]: '7a400000-0000-4000-8000-00000000000b',
}

const readingsRule = (organizationId: string) => {
  const rule = RETENTION_RULES.find(
    ({ subject }) => subject === 'metric_readings.expired',
  )
  if (!rule) throw new Error('metric_readings.expired is not a retention rule')
  return { ...rule, extraWhere: `organization_id = '${organizationId}'` }
}

async function sweep(organizationId: string, batchSize = 500): Promise<void> {
  await createRetentionSweepHandler({
    db,
    clock: () => RUN_AT,
    rules: [readingsRule(organizationId)],
    batchSize,
  })({} as Job)
}

async function seedReading(organizationId: string, recordedAt: Date): Promise<string> {
  const propertyId = PROPERTIES[organizationId]
  const inserted = await db.execute(
    sql`INSERT INTO metric_readings (organization_id, property_id, metric_key, value, recorded_at)
        VALUES (${organizationId}, ${propertyId}, 'portal.scan', 1, ${recordedAt}) RETURNING id`,
  )
  return (inserted.rows[0] as { id: string }).id
}

async function seedCorrection(
  readingId: string,
  sourceEventId: string,
  supersedes: string | null,
): Promise<string> {
  const inserted = await db.execute(
    sql`INSERT INTO metric_corrections (reading_id, source_event_id, kind, reason, actor_type, actor_id, event_at, supersedes_correction_id)
        VALUES (${readingId}, ${sourceEventId}, 'retract', 'test', 'system', 'test', now(), ${supersedes}) RETURNING id`,
  )
  return (inserted.rows[0] as { id: string }).id
}

async function count(table: string, organizationId: string): Promise<number> {
  const result = await db.execute(
    table === 'metric_readings'
      ? sql`SELECT count(*)::int AS n FROM metric_readings WHERE organization_id = ${organizationId}`
      : sql`SELECT count(*)::int AS n FROM metric_corrections c JOIN metric_readings r ON r.id = c.reading_id WHERE r.organization_id = ${organizationId}`,
  )
  return (result.rows[0] as { n: number }).n
}

async function reset(): Promise<void> {
  await db.execute(
    sql`DELETE FROM metric_corrections WHERE reading_id IN (SELECT id FROM metric_readings WHERE organization_id IN (${ORG_A}, ${ORG_B}))`,
  )
  await db.execute(
    sql`DELETE FROM metric_readings WHERE organization_id IN (${ORG_A}, ${ORG_B})`,
  )
}

describe('readings retention (PostgreSQL)', () => {
  beforeEach(async () => {
    await reset()
    for (const [organizationId, id] of Object.entries(PROPERTIES)) {
      await db.execute(
        sql`INSERT INTO properties (id, organization_id, name, slug, timezone)
            VALUES (${id}::uuid, ${organizationId}, 'Readings retention', ${`readings-retention-${id.slice(-1)}`}, 'UTC')
            ON CONFLICT (id) DO NOTHING`,
      )
    }
  })
  afterAll(async () => {
    await reset()
    await db.execute(
      sql`DELETE FROM properties WHERE organization_id IN (${ORG_A}, ${ORG_B})`,
    )
  })

  it('deletes old readings with their correction chain and keeps boundary and current ones', async () => {
    const old = await seedReading(ORG_A, OLD)
    const root = await seedCorrection(old, 'c-root', null)
    await seedCorrection(old, 'c-leaf', root)
    await seedReading(ORG_A, JUST_PAST)
    await seedReading(ORG_A, AT_BOUNDARY)
    const current = await seedReading(ORG_A, CURRENT)
    await seedCorrection(current, 'c-current', null)

    await sweep(ORG_A)

    expect(await count('metric_readings', ORG_A)).toBe(2)
    expect(await count('metric_corrections', ORG_A)).toBe(1)
  })

  it('resumes a capped run and leaves the other tenant alone', async () => {
    for (let i = 0; i < 3; i += 1) {
      const id = await seedReading(ORG_A, OLD)
      await seedCorrection(id, `a-${i}`, null)
    }
    await seedReading(ORG_B, OLD)

    await sweep(ORG_A, 2)
    await sweep(ORG_A, 2)

    expect(await count('metric_readings', ORG_A)).toBe(0)
    expect(await count('metric_corrections', ORG_A)).toBe(0)
    expect(await count('metric_readings', ORG_B)).toBe(1)
  })
})
