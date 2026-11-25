/**
 * Opaque handle to the transaction an exact-current authority holds open.
 * Only the implementation that issued it can use it; callers pass it back
 * unchanged. Inbox uses this declaration directly: it shares the reputation
 * context with Review (ADR 0008, note 2026-11-25).
 */
export type ReviewOpenTransaction = Readonly<{ __brand: 'review.open-transaction' }>
