// LIF-01-T15 — Guest's contribution to the restore resurrection fence.
//
// When a cell is restored from a backup taken before an Organization purge,
// every Guest row that purge destroyed is back: private feedback bodies,
// ratings, permitted contact ciphertext, session pseudonyms. This replayer
// re-applies exactly the erasure the ledger says happened.
//
// It deliberately reuses `drizzleGuestLifecycleWorkbench` rather than writing a
// second delete plan. Two plans would drift, and the plan that drifted would be
// the one that only runs after a disaster — the least exercised code in the
// product deciding what stays behind.

import type {
  BackupErasureLedgerEntry,
  BackupErasureReplayer,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { Tx } from '#/shared/outbox/commit'
import {
  drizzleGuestLifecycleWorkbench,
  type GuestLifecycleWorkbench,
} from './guest-organization-lifecycle.adapter'

/**
 * Re-erase one Organization's Guest rows in a restored cell.
 *
 * Convergent: the row count is read first, so replaying against a cell that was
 * never rolled back past the erasure removes nothing and reports zero.
 */
export const createGuestBackupErasureReplayer = (
  workbench: GuestLifecycleWorkbench = drizzleGuestLifecycleWorkbench,
): BackupErasureReplayer => ({
  context: 'guest',
  subjectClass: 'organization',
  reErase: async (tx: Tx, entry: BackupErasureLedgerEntry): Promise<number> => {
    const resurrected = await workbench.countTenantRows(tx, entry.organizationId)
    if (resurrected === 0) return 0
    await workbench.scrubTenantRows(tx, entry.organizationId)
    return resurrected
  },
})
