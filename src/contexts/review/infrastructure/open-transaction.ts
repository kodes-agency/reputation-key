import type { Tx } from '#/shared/outbox/commit'
import type { ReviewOpenTransaction } from '../application/ports/open-transaction'

/** Hand the open transaction to an authority callback as an opaque handle. */
export const lendReviewTransaction = (tx: Tx): ReviewOpenTransaction =>
  tx as unknown as ReviewOpenTransaction

/** Recover the transaction a Review authority lent out. */
export const borrowReviewTransaction = (handle: ReviewOpenTransaction): Tx =>
  handle as unknown as Tx
