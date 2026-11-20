import { eq } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import {
  productUpdateReceipts,
  productUpdateSettings,
} from '#/shared/db/schema/product-updates.schema'

/** Called inside Identity's lifecycle transaction, never an independent purge. */
export async function purgeProductUpdates(
  tx: Tx,
  organizationId: string,
): Promise<number> {
  const receipts = await tx
    .delete(productUpdateReceipts)
    .where(eq(productUpdateReceipts.organizationId, organizationId))
    .returning({ id: productUpdateReceipts.entryId })
  const settings = await tx
    .delete(productUpdateSettings)
    .where(eq(productUpdateSettings.organizationId, organizationId))
    .returning({ id: productUpdateSettings.userId })
  return receipts.length + settings.length
}
