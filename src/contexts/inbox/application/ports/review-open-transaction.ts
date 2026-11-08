/**
 * Opaque handle to the transaction Review's authority holds open while `apply`
 * runs. Inbox mirrors Review's published shape (ADR 0008) and passes it along
 * unchanged.
 */
export type ReviewOpenTransaction = Readonly<{ __brand: 'review.open-transaction' }>
