// Real PostgreSQL proofs for durable admission, ordering and rolling-release
// leases. Legacy leases remain readable until the outgoing worker drains.

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb, type Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { createOutboxRepository } from '../outbox-repository'

const db = getDb()
const NOW = new Date('2026-11-06T12:00:00.000Z')
const ORG = 'org-delivery-admission-test'
const repo = createOutboxRepository(db, () => NOW)

async function insertEvent(createdAt: Date): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO outbox_events
      (event_type, event_version, payload, organization_id, source_context, source_aggregate_id, created_at)
    VALUES
      ('test.delivery', 1, '{"resourceId":"r-1"}'::jsonb, ${ORG}, 'test', 'agg-1', ${createdAt})
    RETURNING id
  `)
  const row = result.rows[0]
  if (!row) throw new Error('Event fixture missing')
  return row.id
}

async function publicationRow(id: string) {
  const [row] = await db
    .select({
      leaseOwner: outboxEvents.leaseOwner,
      leasedAt: outboxEvents.leasedAt,
      leaseExpiresAt: outboxEvents.leaseExpiresAt,
      publishedAt: outboxEvents.publishedAt,
    })
    .from(outboxEvents)
    .where(eq(outboxEvents.id, id))
  return row
}

async function clean(): Promise<void> {
  await db.execute(sql`DELETE FROM work_items WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM event_consumer_receipts`)
  await db.execute(sql`DELETE FROM outbox_events`)
}

beforeEach(clean)
afterAll(clean)

describe('outbox durable admission', () => {
  it('admits only the oldest rows within a bounded batch and preserves envelope metadata', async () => {
    const t1 = new Date(NOW.getTime() - 3_000)
    const t2 = new Date(NOW.getTime() - 2_000)
    const t3 = new Date(NOW.getTime() - 1_000)
    const id3 = await insertEvent(t3)
    const id1 = await insertEvent(t1)
    const id2 = await insertEvent(t2)

    const admitted = await repo.delivery.schedulePending(2)

    expect(admitted.map((work) => work.subjectId)).toEqual([id1, id2])
    const event = await repo.delivery.readEvent(ORG, id1)
    expect(event).toEqual({
      id: id1,
      eventType: 'test.delivery',
      eventVersion: 1,
      payload: { resourceId: 'r-1' },
      organizationId: ORG,
      propertyId: null,
      sourceContext: 'test',
      sourceAggregateId: 'agg-1',
      recordedAt: t1,
    })
    const rest = await repo.delivery.schedulePending(2)
    expect(rest.map((work) => work.subjectId)).toEqual([id3])
  })

  it('never admits the same fact twice when two workers run concurrently', async () => {
    const ids: string[] = []
    for (let index = 0; index < 20; index++) {
      ids.push(await insertEvent(new Date(NOW.getTime() - (20 - index) * 1_000)))
    }

    const [first, second] = await Promise.all([
      repo.delivery.schedulePending(10),
      repo.delivery.schedulePending(10),
    ])

    const subjects = [...first, ...second].map((work) => work.subjectId)
    expect(subjects).toHaveLength(20)
    expect(new Set(subjects).size).toBe(20)
    expect([...subjects].sort()).toEqual([...ids].sort())
    expect(new Set([...first, ...second].map((work) => work.id)).size).toBe(20)
    expect(await repo.delivery.schedulePending(10)).toEqual([])
  })

  it('returns the batch oldest first regardless of insertion order', async () => {
    const newest = await insertEvent(new Date(NOW.getTime() - 1_000))
    const middle = await insertEvent(new Date(NOW.getTime() - 2_000))
    const oldest = await insertEvent(new Date(NOW.getTime() - 3_000))

    const admitted = await repo.delivery.schedulePending(3)

    expect(admitted.map((work) => work.subjectId)).toEqual([oldest, middle, newest])
  })

  it('breaks timestamp ties by fact ID', async () => {
    const instant = new Date(NOW.getTime() - 5_000)
    const ids = [
      await insertEvent(instant),
      await insertEvent(instant),
      await insertEvent(instant),
    ]

    const admitted = await repo.delivery.schedulePending(3)

    expect(admitted.map((work) => work.subjectId)).toEqual([...ids].sort())
  })

  it('leaves an outgoing worker its active lease and adopts it after expiry', async () => {
    const id = await insertEvent(new Date(NOW.getTime() - 1_000))
    await db.execute(sql`
      UPDATE outbox_events
      SET lease_owner = 'outgoing-worker', leased_at = ${NOW},
          lease_expires_at = ${new Date(NOW.getTime() + 30_000)}
      WHERE id = ${id}::uuid
    `)

    expect(await repo.delivery.schedulePending(10)).toEqual([])
    expect(await publicationRow(id)).toMatchObject({
      leaseOwner: 'outgoing-worker',
      publishedAt: null,
    })
    expect(await repo.delivery.workItems.list(ORG)).toEqual([])

    await db.execute(sql`
      UPDATE outbox_events SET lease_expires_at = ${new Date(NOW.getTime() - 1)}
      WHERE id = ${id}::uuid
    `)
    const adopted = await repo.delivery.schedulePending(10)

    expect(adopted).toHaveLength(1)
    expect(adopted[0]!.subjectId).toBe(id)
    expect(await publicationRow(id)).toEqual({
      publishedAt: NOW,
      leaseOwner: null,
      leasedAt: null,
      leaseExpiresAt: null,
    })
  })

  it('commits publication and pending work together without spending an attempt', async () => {
    const id = await insertEvent(new Date(NOW.getTime() - 1_000))

    const [admitted] = await repo.delivery.schedulePending(1)

    expect(admitted).toMatchObject({ subjectId: id, organizationId: ORG })
    if (!admitted) throw new Error('Admission missing')
    expect(await publicationRow(id)).toMatchObject({ publishedAt: NOW })
    expect(await repo.delivery.workItems.inspect(ORG, admitted.id)).toMatchObject({
      subjectId: id,
      idempotencyKey: id,
      kind: 'outbox-delivery',
      state: 'pending',
      attempts: 0,
      dueAt: NOW,
    })
    expect(await repo.delivery.schedulePending(1)).toEqual([])
  })

  it('rolls back work admission when the publication write fails', async () => {
    const id = await insertEvent(new Date(NOW.getTime() - 1_000))
    const rollback = new Error('rollback admission failure fixture')
    let checked = false
    await expect(
      db.transaction(async (tx) => {
        const transaction = tx as unknown as Database
        // A scratch-database constraint supplies a real failure after work
        // insertion. The outer rollback always removes this planted fault.
        await transaction.execute(
          sql`
          ALTER TABLE outbox_events ADD CONSTRAINT reject_delivery_publication
          CHECK (id <> ${id}::uuid OR published_at IS NULL)
        `.inlineParams(),
        )
        const failing = createOutboxRepository(transaction, () => NOW)
        await expect(failing.delivery.schedulePending(1)).rejects.toMatchObject({
          cause: { code: '23514', constraint: 'reject_delivery_publication' },
        })
        const result = await transaction.execute(sql`
          SELECT
            (SELECT published_at FROM outbox_events WHERE id = ${id}::uuid) AS publication,
            (SELECT count(*)::int FROM work_items
              WHERE organization_id = ${ORG} AND subject_id = ${id}) AS work
        `)
        expect(result.rows[0]).toEqual({ publication: null, work: 0 })
        checked = true
        throw rollback
      }),
    ).rejects.toBe(rollback)
    expect(checked).toBe(true)
    expect(await repo.delivery.workItems.list(ORG)).toEqual([])
  })

  it('keeps the expired legacy lease health read until admission clears it', async () => {
    const expired = await insertEvent(new Date(NOW.getTime() - 2_000))
    const active = await insertEvent(new Date(NOW.getTime() - 1_000))
    // The compatibility health read uses the database clock.
    await db.execute(sql`
      UPDATE outbox_events SET lease_owner = 'outgoing-worker',
        leased_at = NOW(), lease_expires_at = NOW() - INTERVAL '1 second'
      WHERE id = ${expired}::uuid
    `)
    await db.execute(sql`
      UPDATE outbox_events SET lease_owner = 'outgoing-worker',
        leased_at = NOW(), lease_expires_at = NOW() + INTERVAL '1 day'
      WHERE id = ${active}::uuid
    `)
    const rows = await repo.findExpiredLeases(10)
    expect(rows.map((event) => event.id)).toEqual([expired])
    expect(rows[0]!.recordedAt).toEqual(new Date(NOW.getTime() - 2_000))

    // Use the live clock for admission so the active fixture stays excluded.
    await createOutboxRepository(db).delivery.schedulePending(10)
    expect(await repo.findExpiredLeases(10)).toEqual([])
  })
})
