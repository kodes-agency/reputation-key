import { freshUuid } from '#/shared/testing/fresh-uuid'
import type { GuestWithdrawalJournal } from './guest-withdrawal-journal.server'

/** The bucket is a provider transport: record what would be written, in order. */
export const createInMemoryWithdrawalJournal = (
  idGen: () => string = freshUuid,
): GuestWithdrawalJournal & Readonly<{ writes: string[] }> => {
  const writes: string[] = []
  return {
    idGen,
    alert: () => undefined,
    put: async (key) => {
      writes.push(key)
    },
    writes,
  }
}
