import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { organizationId, userId } from '#/shared/domain/ids'
import type { ProductUpdatePerson } from '../../application/ports/product-updates.port'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createProductUpdatesStore } from './product-updates.repository'
import { purgeProductUpdates } from '../product-updates-purge'
import { createIdentityOrganizationExportContributor } from '../identity-organization-export-contributor'

let db: Database
let lease: TestLease
const people: ProductUpdatePerson[] = []

async function person() {
  const id = randomUUID()
  const p = {
    organizationId: organizationId(`updates-org-${id}`),
    userId: userId(`updates-user-${id}`),
  }
  people.push(p)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Updates', $1, now())`,
    [p.organizationId],
  )
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, 'Manager', $2, true, now(), now())`,
    [p.userId, `${id}@example.test`],
  )
  // Non-owner fixture: cleanup need not disable the last-AccountAdmin fence.
  await lease.pool.query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES ($1, $2, $3, 'admin', '2026-01-01')`,
    [randomUUID(), p.userId, p.organizationId],
  )
  return p
}

describe('durable personal product updates', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 5)
    db = drizzle(lease.pool) as Database
  })
  afterAll(async () => {
    if (!lease) return
    for (const p of people) {
      await lease.pool.query('DELETE FROM member WHERE "organizationId" = $1', [
        p.organizationId,
      ])
    }
    await deleteTestOrganizations(
      lease.pool,
      people.map((p) => p.organizationId),
    )
    for (const p of people)
      await lease.pool.query('DELETE FROM "user" WHERE id = $1', [p.userId])
    await lease.release()
  })

  it('defaults ON both without a settings row and after its first insertion', async () => {
    const p = await person(),
      store = createProductUpdatesStore(db)
    expect(await store.read(p)).toMatchObject({
      autoShow: true,
      lastAutoOpenedAt: null,
      seenIds: [],
    })
    await store.claim(p)
    const result = await lease.pool.query(
      'SELECT auto_show FROM product_update_settings WHERE user_id = $1',
      [p.userId],
    )
    expect(result.rows).toEqual([{ auto_show: true }])
  })
  it('lets exactly one of two simultaneous claims win, including the first insert', async () => {
    const p = await person(),
      store = createProductUpdatesStore(db)
    expect((await Promise.all([store.claim(p), store.claim(p)])).sort()).toEqual([
      false,
      true,
    ])
    await db.execute(
      sql`UPDATE product_update_settings SET last_auto_opened_at = now() - interval '8 days' WHERE user_id = ${p.userId}`,
    )
    expect((await Promise.all([store.claim(p), store.claim(p)])).sort()).toEqual([
      false,
      true,
    ])
  })
  it('keeps receipts idempotent and scoped to the session person and Organization', async () => {
    const p = await person(),
      other = await person(),
      store = createProductUpdatesStore(db)
    await Promise.all([store.markSeen(p, ['one', 'one']), store.markSeen(p, ['one'])])
    expect((await store.read(p)).seenIds).toEqual(['one'])
    expect((await store.read(other)).seenIds).toEqual([])
  })
  it('preserves the cooldown on preference saves and refuses claims after opt-out', async () => {
    const p = await person(),
      store = createProductUpdatesStore(db)
    await store.claim(p)
    const before = await store.read(p)
    await store.setAutoShow(p, false)
    expect(await store.claim(p)).toBe(false)
    expect((await store.read(p)).lastAutoOpenedAt).toEqual(before.lastAutoOpenedAt)
  })
  it('exports both collections through the owning Identity contributor', async () => {
    const p = await person(),
      store = createProductUpdatesStore(db)
    await store.setAutoShow(p, false)
    await store.markSeen(p, ['one'])
    const result = await createIdentityOrganizationExportContributor(db).contribute({
      organizationId: p.organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })
    const entry = result.entries.find((e) => e.path.endsWith('.json'))
    expect(entry).toBeDefined()
    const payload = JSON.parse(Buffer.from(entry!.bytes).toString('utf8'))
    expect(payload.productUpdateSettings).toMatchObject([
      { auto_show: false, user_id: p.userId },
    ])
    expect(payload.productUpdateReceipts).toMatchObject([
      { entry_id: 'one', user_id: p.userId },
    ])
  })
  it('purges both collections only for the target Organization and repeats safely', async () => {
    const p = await person(),
      other = await person(),
      store = createProductUpdatesStore(db)
    for (const target of [p, other]) {
      await store.setAutoShow(target, false)
      await store.markSeen(target, ['one'])
    }
    expect(await db.transaction((tx) => purgeProductUpdates(tx, p.organizationId))).toBe(
      2,
    )
    expect(await db.transaction((tx) => purgeProductUpdates(tx, p.organizationId))).toBe(
      0,
    )
    expect(await store.read(p)).toMatchObject({ autoShow: true, seenIds: [] })
    expect(await store.read(other)).toMatchObject({ autoShow: false, seenIds: ['one'] })
  })
})
