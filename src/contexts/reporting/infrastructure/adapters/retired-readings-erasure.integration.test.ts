// The retired-readings erasure against real PostgreSQL: dry-run counts, apply
// with the journal object written before each batch is deleted, a failed
// journal write that deletes nothing, resume after an interruption, and every
// other metric key and Organization left alone.

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import { parseOperatorArgs, type OperatorContext } from '#/shared/ops/operator-command'
import {
  retiredReadingsConfirmationText,
  retiredReadingsErasureCommandSpec as SPEC,
  runRetiredReadingsErasure,
  type RetiredReadingsAuditEvent,
} from '#/shared/ops/retired-readings-erasure-command'
import {
  createRetiredReadingsReplayer,
  createRetiredReadingsStore,
} from './retired-readings-erasure.adapter'

const ORG_A = 'retired-readings-org-a'
const ORG_B = 'retired-readings-org-b'
const PROPERTIES: Readonly<Record<string, string>> = {
  [ORG_A]: '7a500000-0000-4000-8000-00000000000a',
  [ORG_B]: '7a500000-0000-4000-8000-00000000000b',
}
const RECORDED = new Date('2026-11-05T16:37:00.000Z')

const db = getDb()
const store = createRetiredReadingsStore(db)

async function seedReading(organizationId: string, metricKey: string): Promise<string> {
  const inserted = await db.execute(
    sql`INSERT INTO metric_readings (organization_id, property_id, metric_key, value, recorded_at)
        VALUES (${organizationId}, ${PROPERTIES[organizationId]}::uuid, ${metricKey}, 5, ${RECORDED})
        RETURNING id`,
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
        VALUES (${readingId}, ${sourceEventId}, 'retract', 'test', 'system', 'test', now(), ${supersedes})
        RETURNING id`,
  )
  return (inserted.rows[0] as { id: string }).id
}

async function countOf(organizationId: string, metricKey: string): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*)::int AS n FROM metric_readings
        WHERE organization_id = ${organizationId} AND metric_key = ${metricKey}`,
  )
  return (result.rows[0] as { n: number }).n
}

async function correctionCount(organizationId: string): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*)::int AS n FROM metric_corrections c
        JOIN metric_readings r ON r.id = c.reading_id
        WHERE r.organization_id = ${organizationId}`,
  )
  return (result.rows[0] as { n: number }).n
}

async function reset(): Promise<void> {
  await db.execute(
    sql`DELETE FROM metric_corrections WHERE reading_id IN
        (SELECT id FROM metric_readings WHERE organization_id IN (${ORG_A}, ${ORG_B}))
        AND supersedes_correction_id IS NOT NULL`,
  )
  await db.execute(
    sql`DELETE FROM metric_corrections WHERE reading_id IN
        (SELECT id FROM metric_readings WHERE organization_id IN (${ORG_A}, ${ORG_B}))`,
  )
  await db.execute(
    sql`DELETE FROM metric_readings WHERE organization_id IN (${ORG_A}, ${ORG_B})`,
  )
}

/** Five retired readings in A (one with a two-link correction chain), others elsewhere. */
async function seed(): Promise<void> {
  const retired: string[] = []
  for (let n = 0; n < 5; n += 1) retired.push(await seedReading(ORG_A, 'property.review'))
  const root = await seedCorrection(retired[0]!, 'retired-root', null)
  await seedCorrection(retired[0]!, 'retired-head', root)
  await seedReading(ORG_A, 'portal.scan')
  await seedReading(ORG_A, 'portal.rating_average')
  const kept = await seedReading(ORG_A, 'portal.rating')
  await seedCorrection(kept, 'kept-root', null)
  for (let n = 0; n < 2; n += 1) await seedReading(ORG_B, 'property.review')
  await seedReading(ORG_B, 'portal.scan')
}

function parse(...argv: string[]) {
  const parsed = parseOperatorArgs(argv, SPEC)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.args
}

const APPLY = (batchSize: number) => [
  '--operator',
  'op-1',
  '--org',
  ORG_A,
  '--reason',
  'retire stars',
  '--ticket',
  'T-1',
  '--batch-size',
  String(batchSize),
  '--apply',
  '--yes',
  SPEC.name,
  'verified=2026-11-10T09:00:00.000Z',
  'verification=ID-CHECK-1',
  `confirm=${retiredReadingsConfirmationText(ORG_A)}`,
]

async function run(
  argv: string[],
  journal: Parameters<typeof runRetiredReadingsErasure>[0]['journal'],
) {
  const out: string[] = []
  const err: string[] = []
  const audit: RetiredReadingsAuditEvent[] = []
  const args = parse(...argv)
  const ctx: OperatorContext = {
    operatorId: args.operator,
    correlationId: 'corr-1',
    organizationId: args.organizationId,
    dryRun: !args.apply,
    reason: args.reason,
    ticket: args.ticket,
    batchSize: args.batchSize ?? SPEC.batchSize?.default,
    decision: { allowed: true } as OperatorContext['decision'],
  }
  const code = await runRetiredReadingsErasure(
    {
      store,
      journal,
      audit: async (event) => {
        audit.push(event)
      },
    },
    ctx,
    args,
    { out: (line) => out.push(line), err: (line) => err.push(line) },
  )
  return { code, out, err, audit }
}

describe('retired readings erasure (PostgreSQL)', () => {
  beforeEach(async () => {
    await reset()
    for (const [organizationId, id] of Object.entries(PROPERTIES)) {
      await db.execute(
        sql`INSERT INTO properties (id, organization_id, name, slug, timezone)
            VALUES (${id}::uuid, ${organizationId}, 'Retired readings', ${`retired-readings-${id.slice(-1)}`}, 'UTC')
            ON CONFLICT (id) DO NOTHING`,
      )
    }
    await seed()
  })
  afterAll(async () => {
    await reset()
    await db.execute(
      sql`DELETE FROM properties WHERE organization_id IN (${ORG_A}, ${ORG_B})`,
    )
  })

  it('counts per Organization in a dry run and deletes nothing', async () => {
    const result = await run(['--operator', 'op-1'], { put: vi.fn(), alert: vi.fn() })
    expect(result.code).toBe(0)
    const lines = result.out.join('\n')
    expect(lines).toContain(`org=${ORG_A} readings=5 corrections=2`)
    expect(lines).toContain(`org=${ORG_B} readings=2 corrections=0`)
    expect(await countOf(ORG_A, 'property.review')).toBe(5)
    expect(await correctionCount(ORG_A)).toBe(3)
  })

  it('writes each batch journal object before deleting that batch', async () => {
    const seen: Array<{ ids: readonly string[]; stillThere: number }> = []
    const journal = {
      put: async (_key: string, bytes: string) => {
        const ids = decodeErasureJournalEntry(bytes).journalTargets?.ids ?? []
        const rows = await db.execute(
          sql`SELECT count(*)::int AS n FROM metric_readings
              WHERE id IN (${sql.join(
                ids.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`,
        )
        seen.push({ ids, stillThere: (rows.rows[0] as { n: number }).n })
      },
      alert: vi.fn(),
    }
    const result = await run(APPLY(2), journal)
    expect(result.code).toBe(0)
    expect(seen.map((batch) => batch.ids.length)).toEqual([2, 2, 1])
    expect(seen.map((batch) => batch.stillThere)).toEqual([2, 2, 1])
    expect(result.audit).toHaveLength(1)
    expect(result.audit[0]).toMatchObject({ actorId: 'op-1', outcome: 'succeeded' })
    expect(await countOf(ORG_A, 'property.review')).toBe(0)
    expect(await correctionCount(ORG_A)).toBe(1)
  })

  it('deletes nothing and alerts when the journal write fails', async () => {
    const alert = vi.fn()
    const result = await run(APPLY(2), {
      put: async () => {
        throw new Error('bucket unavailable')
      },
      alert,
    })
    expect(result.code).toBe(1)
    expect(alert).toHaveBeenCalledTimes(1)
    expect(await countOf(ORG_A, 'property.review')).toBe(5)
    expect(await correctionCount(ORG_A)).toBe(3)
    expect(result.audit.map((event) => event.outcome)).toEqual(['failed'])
  })

  it('resumes by running the same command again after an interruption', async () => {
    let writes = 0
    const flaky = {
      put: async () => {
        writes += 1
        if (writes === 2) throw new Error('interrupted')
      },
      alert: vi.fn(),
    }
    const first = await run(APPLY(2), flaky)
    expect(first.code).toBe(1)
    expect(await countOf(ORG_A, 'property.review')).toBe(3)

    const second = await run(APPLY(2), { put: async () => {}, alert: vi.fn() })
    expect(second.code).toBe(0)
    expect(await countOf(ORG_A, 'property.review')).toBe(0)
  })

  it('leaves every other key, correction and Organization untouched', async () => {
    await run(APPLY(50), { put: async () => {}, alert: vi.fn() })
    expect(await countOf(ORG_A, 'portal.scan')).toBe(1)
    expect(await countOf(ORG_A, 'portal.rating_average')).toBe(1)
    expect(await countOf(ORG_A, 'portal.rating')).toBe(1)
    expect(await correctionCount(ORG_A)).toBe(1)
    expect(await countOf(ORG_B, 'property.review')).toBe(2)
    expect(await countOf(ORG_B, 'portal.scan')).toBe(1)
  })

  it('replays a journaled batch in a restored cell without touching other keys', async () => {
    const puts: string[] = []
    await run(APPLY(50), {
      put: async (_key, bytes) => void puts.push(bytes),
      alert: vi.fn(),
    })
    const entry = decodeErasureJournalEntry(puts[0]!)
    const ids = entry.journalTargets?.ids ?? []
    const reseeded = await seedReading(ORG_A, 'property.review')
    const kept = await seedReading(ORG_A, 'portal.scan')
    const erased = await db.transaction((tx) =>
      createRetiredReadingsReplayer().reErase(tx, {
        ...entry,
        journalTargets: { kind: 'purge_batch', ids: [reseeded, ...ids] },
      }),
    )
    expect(erased).toBe(1)
    expect(await countOf(ORG_A, 'property.review')).toBe(0)
    expect(await countOf(ORG_A, 'portal.scan')).toBe(2)
    expect(kept).toBeTruthy()
  })
})
