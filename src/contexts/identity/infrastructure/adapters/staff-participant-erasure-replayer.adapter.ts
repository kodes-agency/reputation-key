// Replays journaled Staff Participant erasures in a restored cell.

import type {
  BackupErasureLedgerEntry,
  BackupErasureReplayer,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { Tx } from '#/shared/outbox/commit'
import { eraseStaffParticipants } from './staff-participant-erasure'

/**
 * Re-erase the participants named by the entry, inside the entry's Organization
 * only. The same erasure the executor ran, so a restored person is pseudonymised
 * and their login removed again.
 */
export const createStaffParticipantErasureReplayer = (): BackupErasureReplayer => ({
  context: 'staff',
  subjectClass: 'privacy_subject',
  targetKind: 'staff_participant',
  reErase: async (tx: Tx, entry: BackupErasureLedgerEntry): Promise<number> => {
    if (
      entry.context !== 'staff' ||
      entry.subjectClass !== 'privacy_subject' ||
      entry.journalTargets?.kind !== 'staff_participant'
    ) {
      throw new Error('Staff replayer requires a journaled Staff Participant erasure')
    }
    const done = await eraseStaffParticipants(tx, {
      organizationId: entry.organizationId,
      participantIds: entry.journalTargets.ids,
      at: entry.effectiveErasureAt,
    })
    return done.participants + done.logins + done.memberships
  },
})
