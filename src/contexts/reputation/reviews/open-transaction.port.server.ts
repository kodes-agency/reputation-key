/**
 * Opaque handle to the transaction an exact-current authority holds open.
 * Only the implementation that issued it can use it; callers pass it back
 * unchanged. Consumers mirror this shape in their own context (ADR 0008).
 */
export type ReviewOpenTransaction = Readonly<{ __brand: 'review.open-transaction' }>
