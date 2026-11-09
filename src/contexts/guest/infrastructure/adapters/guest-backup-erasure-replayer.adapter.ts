// Reuse Guest's purge plan so restore replay cannot drift from tenant erasure.

import type {
  BackupErasureLedgerEntry,
  BackupErasureReplayer,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { Tx } from '#/shared/outbox/commit'
import { createGuestPropertyEraseContributor } from './guest-property-erase.adapter'
import {
  countGuestLegacyPropertyRows,
  eraseGuestLegacyPropertyRows,
} from './guest-property-legacy-rows'
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
    if (
      entry.context !== 'guest' ||
      entry.subjectClass !== 'organization' ||
      entry.journalTargets
    ) {
      throw new Error('Guest replayer requires an Organization-scoped Guest erasure')
    }
    const resurrected = await workbench.countTenantRows(tx, entry.organizationId)
    if (resurrected === 0) return 0
    await workbench.scrubTenantRows(tx, entry.organizationId)
    return resurrected
  },
})

/**
 * Re-erase one Property's Guest rows in a restored cell, siblings untouched.
 *
 * Convergent: the rows are counted first, so a cell that was never rolled back
 * past the erasure removes nothing and reports zero.
 */
export const createGuestPropertyErasureReplayer = (): BackupErasureReplayer => {
  const contributor = createGuestPropertyEraseContributor()
  return {
    context: 'guest',
    subjectClass: 'property',
    reErase: async (tx: Tx, entry: BackupErasureLedgerEntry): Promise<number> => {
      if (
        entry.context !== 'guest' ||
        entry.subjectClass !== 'property' ||
        !entry.propertyId ||
        entry.journalTargets
      ) {
        throw new Error('Guest replayer requires a Property-scoped Guest erasure')
      }
      const scope = { organizationId: entry.organizationId, propertyId: entry.propertyId }
      const resurrected = [
        ...(await contributor.inventory(tx, scope)),
        ...(await countGuestLegacyPropertyRows(tx, scope)),
      ].reduce((sum, { rowCount }) => sum + rowCount, 0)
      if (resurrected === 0) return 0
      await contributor.erase(tx, scope)
      await eraseGuestLegacyPropertyRows(tx, scope)
      return resurrected
    },
  }
}
