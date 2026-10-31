import type { Database } from '../../src/shared/db'
import { member } from '../../src/shared/db/schema/auth'
import { productUpdateReceipts } from '../../src/shared/db/schema/product-updates.schema'
import { PRODUCT_UPDATES } from '../../src/shared/whats-new/entries'

export type SeedMembership = Readonly<{
  id: string
  userId: string
  organizationId: string
  role: 'owner' | 'admin' | 'member'
}>

/**
 * One seeded membership, dated `createdAt`. Seeded memberships predate every
 * product update, so a journey would meet What's new opening by itself; the e2e
 * baseline has seen them all (src/shared/whats-new).
 */
export async function upsertSeedMembership(
  db: Database,
  input: SeedMembership,
  createdAt: Date,
): Promise<void> {
  await db
    .insert(member)
    .values({ ...input, createdAt })
    .onConflictDoUpdate({ target: member.id, set: { role: input.role } })
  await db
    .insert(productUpdateReceipts)
    .values(
      PRODUCT_UPDATES.map(({ id }) => ({
        userId: input.userId,
        organizationId: input.organizationId,
        entryId: id,
      })),
    )
    .onConflictDoNothing()
}
