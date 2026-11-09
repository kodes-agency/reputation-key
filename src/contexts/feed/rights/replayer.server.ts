// Restore replay for notification erasure: runs the production purge inside the
// fence's transaction, for a Property entry or an Organization entry.

import type { BackupErasureReplayer } from '#/shared/db/lifecycle/backup-erasure-ledger'
import { purgeNotificationRightsData } from './purge.server'

const REPLAY_BATCH_SIZE = 500

function notificationReplayer(
  subjectClass: BackupErasureReplayer['subjectClass'],
): BackupErasureReplayer {
  return {
    context: 'notification',
    subjectClass,
    async reErase(tx, entry) {
      const counts = await purgeNotificationRightsData(
        tx,
        {
          organizationId: entry.organizationId,
          ...(entry.propertyId ? { propertyId: entry.propertyId } : {}),
        },
        REPLAY_BATCH_SIZE,
      )
      return Object.values(counts).reduce((sum, n) => sum + n, 0)
    },
  }
}

export function createNotificationRightsReplayers(): ReadonlyArray<BackupErasureReplayer> {
  return [notificationReplayer('property'), notificationReplayer('organization')]
}
