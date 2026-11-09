import type { Tx } from '#/shared/outbox/commit'

/**
 * Opaque handle to the transaction Review's authority holds open while `apply`
 * runs. Inbox mirrors Review's published shape (ADR 0008) and passes it along
 * unchanged.
 */
export type ReviewOpenTransaction = Readonly<{ __brand: 'review.open-transaction' }>

/** Recover the transaction Review lent, for Inbox commands that join it. */
export const borrowReviewTransaction = (
  handle: ReviewOpenTransaction | undefined,
): Tx | undefined => handle as unknown as Tx | undefined

/** The trailing command argument for a lent transaction; empty when none is lent. */
export const lentTransactionArgs = (
  handle: ReviewOpenTransaction | undefined,
): readonly [Tx] | readonly [] => (handle ? [borrowReviewTransaction(handle)!] : [])
