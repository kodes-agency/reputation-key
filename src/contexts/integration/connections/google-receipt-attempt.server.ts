import { and, eq } from 'drizzle-orm'
import { z } from 'zod/v4'
import { idempotencyReceipts } from '#/shared/db/schema/outbox.schema'
import type { Tx } from '#/shared/outbox/commit'

/** An ISO timestamp stored in a receipt payload, read back as a `Date`. */
export const receiptDate = z.string().transform((value, ctx) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'invalid date' })
    return z.NEVER
  }
  return parsed
})

/**
 * Receipt-backed state machine rows: one JSON payload per attempt in
 * `idempotency_receipts`, dates stored as ISO strings and absent values as
 * explicit `null`.
 */
export function createReceiptAttemptStore<Row extends Readonly<{ id: string }>>(
  scope: string,
  schema: z.ZodType<Row>,
  invalidError: string,
) {
  const parse = (payload: unknown): Row => {
    const parsed = schema.safeParse(payload)
    if (!parsed.success) throw new Error(invalidError)
    return parsed.data
  }
  const toPayload = (row: Row): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(row as Record<string, unknown>).map(([field, value]) => [
        field,
        value instanceof Date ? value.toISOString() : value,
      ]),
    )

  return {
    parse,
    toPayload,
    scope,
    async readForUpdate(tx: Tx, id: string): Promise<Row | null> {
      const [receipt] = await tx
        .select({ payload: idempotencyReceipts.payload })
        .from(idempotencyReceipts)
        .where(and(eq(idempotencyReceipts.scope, scope), eq(idempotencyReceipts.key, id)))
        .for('update')
        .limit(1)
      return receipt ? parse(receipt.payload) : null
    },
    async update(tx: Tx, row: Row): Promise<boolean> {
      const updated = await tx
        .update(idempotencyReceipts)
        .set({ payload: toPayload(row) })
        .where(
          and(eq(idempotencyReceipts.scope, scope), eq(idempotencyReceipts.key, row.id)),
        )
        .returning({ key: idempotencyReceipts.key })
      return updated.length === 1
    },
  }
}
