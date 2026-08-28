/**
 * `promotion.backup_pitr` — the platform's own receipt that a restorable
 * backup and a point-in-time-recovery window cover the promotion moment.
 *
 * `source` is a hard literal `'platform_receipt'`. The application cannot
 * attest its own recoverability: "the app says a backup ran" is precisely the
 * claim that is worthless during an incident, because the process making the
 * claim is the one that may be lost. The receipt digest and receipt id must
 * come from the platform export.
 *
 * The window is checked against `promotionAt`, not against capture time: a
 * receipt whose PITR window closes before the promotion it is supposed to
 * protect is not evidence for that promotion.
 */

import { z } from 'zod/v4'
import {
  parseCanonicalReleaseEvidence,
  releaseEvidenceIdentitySchema,
  releaseEvidenceSha256Schema,
  releaseEvidenceTimestampSchema,
  type CanonicalReleaseEvidenceParseResult,
} from '../candidate-bound-evidence'
import {
  LIVE_EVIDENCE_VERSIONS,
  liveEvidenceBaseSchema,
  liveEvidenceCommonIssues,
  liveEvidenceTextSchema,
} from './common'

export const BACKUP_PITR_RECEIPT_EVIDENCE_VERSION =
  LIVE_EVIDENCE_VERSIONS['promotion.backup_pitr']

const backupPitrReceiptEvidenceSchema = liveEvidenceBaseSchema(
  BACKUP_PITR_RECEIPT_EVIDENCE_VERSION,
  'backup-pitr-receipt',
)
  .extend({
    source: z.literal('platform_receipt'),
    platform: z.literal('railway'),
    promotionAt: releaseEvidenceTimestampSchema,
    receipt: z
      .object({
        receiptId: releaseEvidenceIdentitySchema,
        receiptSha256: releaseEvidenceSha256Schema,
        exportedAt: releaseEvidenceTimestampSchema,
        databaseServiceId: releaseEvidenceIdentitySchema,
        projectId: releaseEvidenceIdentitySchema,
        environmentId: releaseEvidenceIdentitySchema,
      })
      .strict(),
    backup: z
      .object({
        snapshotId: releaseEvidenceIdentitySchema,
        takenAt: releaseEvidenceTimestampSchema,
        sizeBytes: z.number().int().safe().positive(),
        restoreVerifiedAt: releaseEvidenceTimestampSchema,
        restoreVerificationSha256: releaseEvidenceSha256Schema,
      })
      .strict(),
    pitrWindow: z
      .object({
        earliestRestorableAt: releaseEvidenceTimestampSchema,
        latestRestorableAt: releaseEvidenceTimestampSchema,
        walArchivingEnabled: z.literal(true),
        summary: liveEvidenceTextSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    liveEvidenceCommonIssues(value, context)
    if (
      value.receipt.projectId !== value.candidate.projectId ||
      value.receipt.environmentId !== value.candidate.environmentId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['receipt', 'projectId'],
        message: 'the receipt must belong to the promotion target project/environment',
      })
    }
    const promotionAt = Date.parse(value.promotionAt)
    const earliest = Date.parse(value.pitrWindow.earliestRestorableAt)
    const latest = Date.parse(value.pitrWindow.latestRestorableAt)
    if (latest <= earliest) {
      context.addIssue({
        code: 'custom',
        path: ['pitrWindow', 'latestRestorableAt'],
        message: 'the PITR window must be a non-empty interval',
      })
    }
    if (promotionAt < earliest || promotionAt > latest) {
      context.addIssue({
        code: 'custom',
        path: ['pitrWindow'],
        message: 'the PITR window does not cover the promotion timestamp',
      })
    }
    if (Date.parse(value.backup.takenAt) > promotionAt) {
      context.addIssue({
        code: 'custom',
        path: ['backup', 'takenAt'],
        message: 'the backup must predate the promotion it protects',
      })
    }
    if (Date.parse(value.backup.restoreVerifiedAt) < Date.parse(value.backup.takenAt)) {
      context.addIssue({
        code: 'custom',
        path: ['backup', 'restoreVerifiedAt'],
        message: 'restore verification predates the backup',
      })
    }
    if (Date.parse(value.capturedAt) < Date.parse(value.receipt.exportedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['capturedAt'],
        message: 'capture predates the platform receipt export',
      })
    }
  })

export type BackupPitrReceiptEvidence = z.infer<typeof backupPitrReceiptEvidenceSchema>

export function parseBackupPitrReceiptEvidence(
  content: string,
): CanonicalReleaseEvidenceParseResult<BackupPitrReceiptEvidence> {
  return parseCanonicalReleaseEvidence({
    content,
    schema: backupPitrReceiptEvidenceSchema,
    label: 'Backup/PITR receipt evidence',
  })
}
