import type { ReviewOpenTransaction } from './open-transaction.port.server'

/**
 * What a fake exact-current authority passes where a real one lends its open
 * transaction. A fake holds no Review transaction, so nothing is lent:
 * `borrowReviewTransaction` hands back no transaction and the Inbox command
 * opens its own.
 */
export const noLentReviewTransaction = undefined as unknown as ReviewOpenTransaction
