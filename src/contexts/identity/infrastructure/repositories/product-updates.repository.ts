import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { member, productUpdateReceipts, productUpdateSettings } from '#/shared/db/schema'
import type {
  ProductUpdatePerson,
  ProductUpdatesStore,
} from '../../application/ports/product-updates.port'

const personWhere = (person: ProductUpdatePerson) =>
  and(
    eq(productUpdateSettings.userId, person.userId),
    eq(productUpdateSettings.organizationId, person.organizationId),
  )

async function read(db: Database, person: ProductUpdatePerson) {
  const [members, settings, receipts] = await Promise.all([
    db
      .select({ createdAt: member.createdAt })
      .from(member)
      .where(
        and(
          eq(member.userId, person.userId),
          eq(member.organizationId, person.organizationId),
        ),
      ),
    db.select().from(productUpdateSettings).where(personWhere(person)),
    db
      .select({ id: productUpdateReceipts.entryId })
      .from(productUpdateReceipts)
      .where(
        and(
          eq(productUpdateReceipts.userId, person.userId),
          eq(productUpdateReceipts.organizationId, person.organizationId),
        ),
      ),
  ])
  if (!members[0]) throw new Error('Product updates membership is unavailable')
  return {
    membershipStartedAt: members[0].createdAt,
    autoShow: settings[0]?.autoShow ?? true,
    lastAutoOpenedAt: settings[0]?.lastAutoOpenedAt ?? null,
    seenIds: receipts.map(({ id }) => id),
  }
}

async function claim(db: Database, person: ProductUpdatePerson): Promise<boolean> {
  // ON CONFLICT serializes devices on the composite key. The predicate sees the
  // winner's committed timestamp and a concurrent preference change, not a stale read.
  const rows = await db
    .insert(productUpdateSettings)
    .values({
      ...person,
      lastAutoOpenedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [productUpdateSettings.userId, productUpdateSettings.organizationId],
      set: { lastAutoOpenedAt: sql`now()`, updatedAt: sql`now()` },
      setWhere: sql`${productUpdateSettings.autoShow} AND
      (${productUpdateSettings.lastAutoOpenedAt} IS NULL OR
       ${productUpdateSettings.lastAutoOpenedAt} < now() - interval '7 days')`,
    })
    .returning({ userId: productUpdateSettings.userId })
  return rows.length === 1
}

export function createProductUpdatesStore(db: Database): ProductUpdatesStore {
  return {
    read: (person) => read(db, person),
    claim: (person) => claim(db, person),
    markSeen: async (person, entryIds) => {
      if (entryIds.length === 0) return
      await db
        .insert(productUpdateReceipts)
        .values([...new Set(entryIds)].map((entryId) => ({ ...person, entryId })))
        .onConflictDoNothing()
    },
    setAutoShow: async (person, autoShow) => {
      await db
        .insert(productUpdateSettings)
        .values({ ...person, autoShow })
        .onConflictDoUpdate({
          target: [productUpdateSettings.userId, productUpdateSettings.organizationId],
          set: { autoShow, updatedAt: sql`now()` },
        })
    },
  }
}
