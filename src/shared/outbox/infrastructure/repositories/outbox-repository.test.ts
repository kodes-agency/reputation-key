// BQC-3.7 — outbox repository lease lifecycle tests (real PostgreSQL).
// Proves the claim/lease/renew/reclaim/release contract under multiple
// relay workers:
//   (a) two concurrent claimers never claim the same row twice (SKIP LOCKED)
//   (b) renewLease extends lease_expires_at only for the owner's rows
//   (c) an expired-lease row is reclaimed by a second relay's claim
//   (d) markPublished clears the lease fields
//   (e) claim order is created_at ascending
// Plus: claimed rows carry recordedAt (row created_at) for the envelope, and
// findExpiredLeases (now wired into health-metrics) returns expired,
// unpublished rows with recordedAt.

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { createOutboxRepository } from '../outbox-repository'

const db = getDb()
const repo = createOutboxRepository(db)

const NOW = Date.now()

async function insertEvent(createdAt: Date): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO outbox_events
      (event_type, event_version, payload, organization_id, source_context, source_aggregate_id, created_at)
    VALUES
      ('test.lease', 1, '{"resourceId":"r-1"}'::jsonb, 'org-lease-test', 'test', 'agg-1', ${createdAt})
    RETURNING id
  `)
  return (result.rows[0] as { id: string }).id
}

/** Epoch ms of a row's lease columns, for clock-skew-proof comparisons. */
async function leaseRow(id: string): Promise<{
  leaseOwner: string | null
  leaseExpiresAtMs: number | null
  publishedAtMs: number | null
}> {
  const result = await db.execute(sql`
    SELECT lease_owner AS "leaseOwner",
           (EXTRACT(EPOCH FROM lease_expires_at) * 1000)::float8 AS "leaseExpiresAtMs",
           (EXTRACT(EPOCH FROM published_at) * 1000)::float8 AS "publishedAtMs"
    FROM outbox_events WHERE id = ${id}
  `)
  return result.rows[0] as {
    leaseOwner: string | null
    leaseExpiresAtMs: number | null
    publishedAtMs: number | null
  }
}

async function clean(): Promise<void> {
  await db.execute(sql`DELETE FROM event_consumer_receipts`)
  await db.execute(sql`DELETE FROM outbox_events`)
}

beforeEach(clean)
afterAll(clean)

describe('outbox repository lease lifecycle (BQC-3.7)', () => {
  it('claims in created_at order and carries recordedAt from the row', async () => {
    const t1 = new Date(NOW - 3000)
    const t2 = new Date(NOW - 2000)
    const t3 = new Date(NOW - 1000)
    // Insert out of order to prove ordering comes from created_at, not insertion.
    const id3 = await insertEvent(t3)
    const id1 = await insertEvent(t1)
    const id2 = await insertEvent(t2)

    // A limit claims only the oldest rows.
    const claimed = await repo.claimUnpublished(2, 'relay-a', 30_000)

    expect(claimed.map((e) => e.id)).toEqual([id1, id2])
    for (const event of claimed) {
      expect(event.recordedAt).toBeInstanceOf(Date)
    }
    expect(claimed[0]!.recordedAt.getTime()).toBe(t1.getTime())

    // The remaining unleased row is claimed next (leased rows are skipped).
    const rest = await repo.claimUnpublished(2, 'relay-a', 30_000)
    expect(rest.map((e) => e.id)).toEqual([id3])
  })

  it('two concurrent claimers never claim the same row twice (SKIP LOCKED)', async () => {
    const ids: string[] = []
    for (let i = 0; i < 20; i++) {
      ids.push(await insertEvent(new Date(NOW - (20 - i) * 1000)))
    }

    const [claimA, claimB] = await Promise.all([
      repo.claimUnpublished(10, 'relay-a', 30_000),
      repo.claimUnpublished(10, 'relay-b', 30_000),
    ])

    const idsA = new Set(claimA.map((e) => e.id))
    const idsB = new Set(claimB.map((e) => e.id))
    const overlap = [...idsA].filter((id) => idsB.has(id))

    expect(overlap).toEqual([])
    // Whether serialized or truly concurrent, every row is claimed exactly once.
    expect(claimA.length + claimB.length).toBe(20)
  })

  it('renewLease extends lease_expires_at only for the owner\u2019s unpublished rows', async () => {
    const a1 = await insertEvent(new Date(NOW - 4000))
    const a2 = await insertEvent(new Date(NOW - 3000))
    const b1 = await insertEvent(new Date(NOW - 2000))
    const b2 = await insertEvent(new Date(NOW - 1000))

    const claimA = await repo.claimUnpublished(2, 'relay-a', 30_000)
    const claimB = await repo.claimUnpublished(2, 'relay-b', 30_000)
    expect(claimA.map((e) => e.id)).toEqual([a1, a2])
    expect(claimB.map((e) => e.id)).toEqual([b1, b2])

    const before = {
      a1: (await leaseRow(a1)).leaseExpiresAtMs!,
      b1: (await leaseRow(b1)).leaseExpiresAtMs!,
    }

    // relay-a renews a batch that (mistakenly or racily) includes relay-b's row.
    const renewed = await repo.renewLease([a1, a2, b1], 'relay-a', 90_000)
    expect(renewed).toBe(2) // only relay-a's own rows

    const after = {
      a1: (await leaseRow(a1)).leaseExpiresAtMs!,
      a2: (await leaseRow(a2)).leaseExpiresAtMs!,
      b1: (await leaseRow(b1)).leaseExpiresAtMs!,
      b2: (await leaseRow(b2)).leaseExpiresAtMs!,
    }

    // Renewed rows move from ~30s to ~90s out; relay-b's rows are untouched.
    expect(after.a1).toBeGreaterThan(before.a1 + 30_000)
    expect(after.a2).toBeGreaterThan(before.a1 + 30_000)
    expect(after.b1).toBe(before.b1)
    expect(after.b2).toBeLessThan(after.a1)

    // A published row is never renewed (published_at IS NULL guard).
    await repo.markPublished(a1)
    const renewedAfterPublish = await repo.renewLease([a1, a2], 'relay-a', 120_000)
    expect(renewedAfterPublish).toBe(1)
    expect((await leaseRow(a1)).leaseExpiresAtMs).toBeNull()
  })

  it('reclaims an expired-lease row under a second relay, but not an unexpired one', async () => {
    const id = await insertEvent(new Date(NOW - 1000))

    const first = await repo.claimUnpublished(10, 'relay-a', 30_000)
    expect(first).toHaveLength(1)

    // Unexpired lease — relay-b cannot take it.
    const blocked = await repo.claimUnpublished(10, 'relay-b', 30_000)
    expect(blocked).toHaveLength(0)

    // Expire the lease, then relay-b reclaims and owns it.
    await repo.renewLease([id], 'relay-a', -60_000)
    const reclaimed = await repo.claimUnpublished(10, 'relay-b', 30_000)
    expect(reclaimed).toHaveLength(1)
    expect(reclaimed[0]!.id).toBe(id)
    expect((await leaseRow(id)).leaseOwner).toBe('relay-b')
  })

  it('markPublished clears lease fields and excludes the row from claims', async () => {
    const id = await insertEvent(new Date(NOW - 1000))
    await repo.claimUnpublished(10, 'relay-a', 30_000)

    await repo.markPublished(id)

    const row = await leaseRow(id)
    expect(row.publishedAtMs).not.toBeNull()
    expect(row.leaseOwner).toBeNull()
    expect(row.leaseExpiresAtMs).toBeNull()

    // Even after the lease would have expired, published rows are never claimed.
    const again = await repo.claimUnpublished(10, 'relay-b', 30_000)
    expect(again).toHaveLength(0)
  })

  it('findExpiredLeases returns unpublished expired rows with recordedAt', async () => {
    const expired = await insertEvent(new Date(NOW - 2000))
    await insertEvent(new Date(NOW - 1000)) // active lease — must not surface

    await repo.claimUnpublished(2, 'relay-a', 30_000)
    // Expire only the first row's lease (ownership-guarded renew with negative duration).
    await repo.renewLease([expired], 'relay-a', -60_000)

    const rows = await repo.findExpiredLeases(10)
    expect(rows.map((r) => r.id)).toEqual([expired])
    expect(rows[0]!.recordedAt).toBeInstanceOf(Date)
    expect(rows[0]!.recordedAt.getTime()).toBe(new Date(NOW - 2000).getTime())

    // Publish the expired row — it drops out of the expired-lease signal.
    await repo.markPublished(expired)
    const afterPublish = await repo.findExpiredLeases(10)
    expect(afterPublish).toHaveLength(0)
  })
})
