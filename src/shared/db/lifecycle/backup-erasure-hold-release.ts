// Backup erasure hold releases, appended to the shared lifecycle event table.
// The table's idempotency index keeps a repeated release at-most-once.

import { and, eq, sql } from 'drizzle-orm'
import { backupErasureLedger } from '#/shared/db/schema/backup-erasure-ledger.schema'
import { organizationLifecycleEvents } from '#/shared/db/schema/organization-lifecycle.schema'
import type { Tx } from '#/shared/outbox/commit'

const BACKUP_HOLD_RELEASE_KIND_PREFIX = 'backup_erasure_hold_release'

const backupHoldReleaseKind = (ledgerEntryId: string): string =>
  `${BACKUP_HOLD_RELEASE_KIND_PREFIX}:${ledgerEntryId}`

function objectPayload(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${subject} payload is invalid`)
  }
  return value as Record<string, unknown>
}

function requiredString(
  payload: Record<string, unknown>,
  key: string,
  subject: string,
): string {
  const value = payload[key]
  if (typeof value !== 'string') throw new Error(`${subject} payload is invalid`)
  return value
}

export type BackupErasureHoldReleaseEvent = Readonly<{
  ledgerEntryId: string
  holdReference: string
  authorityRef: string
  releasedAt: Date
}>

export async function appendBackupErasureHoldReleaseEvent(
  tx: Tx,
  release: BackupErasureHoldReleaseEvent,
): Promise<void> {
  const ledgers = await tx
    .select({
      organizationId: backupErasureLedger.organizationId,
      context: backupErasureLedger.context,
    })
    .from(backupErasureLedger)
    .where(eq(backupErasureLedger.id, release.ledgerEntryId))
    .limit(1)
  const ledger = ledgers[0]
  if (!ledger) throw new Error('backup erasure ledger entry does not exist')

  await tx
    .insert(organizationLifecycleEvents)
    .values({
      organizationId: ledger.organizationId,
      context: ledger.context,
      phase: 'hold_release',
      kind: backupHoldReleaseKind(release.ledgerEntryId),
      payload: {
        ledgerEntryId: release.ledgerEntryId,
        holdReference: release.holdReference,
        authorityRef: release.authorityRef,
      },
      recordedAt: release.releasedAt,
    })
    .onConflictDoNothing({
      target: [
        organizationLifecycleEvents.context,
        organizationLifecycleEvents.phase,
        organizationLifecycleEvents.kind,
      ],
    })
}

export async function readBackupErasureHoldReleaseEvents(
  tx: Tx,
): Promise<readonly BackupErasureHoldReleaseEvent[]> {
  const rows = await tx
    .select({
      payload: organizationLifecycleEvents.payload,
      releasedAt: organizationLifecycleEvents.recordedAt,
    })
    .from(organizationLifecycleEvents)
    .where(
      and(
        eq(organizationLifecycleEvents.phase, 'hold_release'),
        sql`${organizationLifecycleEvents.kind} LIKE ${`${BACKUP_HOLD_RELEASE_KIND_PREFIX}:%`}`,
      ),
    )

  return rows.map((row) => {
    const subject = 'Backup erasure hold release event'
    const payload = objectPayload(row.payload, subject)
    return {
      ledgerEntryId: requiredString(payload, 'ledgerEntryId', subject),
      holdReference: requiredString(payload, 'holdReference', subject),
      authorityRef: requiredString(payload, 'authorityRef', subject),
      releasedAt: row.releasedAt,
    }
  })
}
