/**
 * `preproduction.isolated_restore_migration` — the migration rehearsal that
 * proved the candidate's heads apply to a restore of real production shape.
 *
 * The dangerous version of this proof is the one run against the live
 * database. `isolation.targetIsProductionDatabase` must be false and the
 * restored target must carry its own project/environment identity, distinct
 * from the promotion target. Migrations are expand-only, so the artifact also
 * records that no destructive statement executed.
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

export const ISOLATED_RESTORE_MIGRATION_EVIDENCE_VERSION =
  LIVE_EVIDENCE_VERSIONS['preproduction.isolated_restore_migration']

const MIGRATION_TAG = /^[0-9]{4}_[a-z0-9_]{1,120}$/u

const isolatedRestoreMigrationEvidenceSchema = liveEvidenceBaseSchema(
  ISOLATED_RESTORE_MIGRATION_EVIDENCE_VERSION,
  'isolated-restore-migration',
)
  .extend({
    startedAt: releaseEvidenceTimestampSchema,
    completedAt: releaseEvidenceTimestampSchema,
    restore: z
      .object({
        backupReceiptSha256: releaseEvidenceSha256Schema,
        backupTakenAt: releaseEvidenceTimestampSchema,
        restoredRowCount: z.number().int().safe().nonnegative(),
      })
      .strict(),
    isolation: z
      .object({
        targetIsProductionDatabase: z.literal(false),
        targetProjectId: releaseEvidenceIdentitySchema,
        targetEnvironmentId: releaseEvidenceIdentitySchema,
        externalEffectsBlocked: z.literal(true),
      })
      .strict(),
    migration: z
      .object({
        fromHeadTag: z.string().regex(MIGRATION_TAG),
        toHeadTag: z.string().regex(MIGRATION_TAG),
        journalSha256: releaseEvidenceSha256Schema,
        appliedCount: z.number().int().safe().positive(),
        destructiveStatementCount: z.literal(0),
        compatibilityMirrorsRetained: z.literal(true),
        durationMs: z.number().int().safe().nonnegative(),
      })
      .strict(),
    verification: z
      .object({
        postMigrationDriftCount: z.number().int().safe().nonnegative(),
        orphanedRowCount: z.number().int().safe().nonnegative(),
        reportSha256: releaseEvidenceSha256Schema,
        summary: liveEvidenceTextSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    liveEvidenceCommonIssues(value, context)
    if (
      value.isolation.targetProjectId === value.candidate.projectId ||
      value.isolation.targetEnvironmentId === value.candidate.environmentId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['isolation', 'targetProjectId'],
        message:
          'the restore target must not be the promotion target project or environment',
      })
    }
    if (value.migration.fromHeadTag >= value.migration.toHeadTag) {
      context.addIssue({
        code: 'custom',
        path: ['migration', 'toHeadTag'],
        message: 'migrations are expand-only and must advance the head tag',
      })
    }
    if (value.outcome === 'passed') {
      if (value.verification.postMigrationDriftCount !== 0) {
        context.addIssue({
          code: 'custom',
          path: ['verification', 'postMigrationDriftCount'],
          message: 'passed rehearsal requires zero post-migration drift',
        })
      }
      if (value.verification.orphanedRowCount !== 0) {
        context.addIssue({
          code: 'custom',
          path: ['verification', 'orphanedRowCount'],
          message: 'passed rehearsal requires zero orphaned rows',
        })
      }
    }
    if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'completion predates start',
      })
    }
    if (Date.parse(value.capturedAt) < Date.parse(value.completedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['capturedAt'],
        message: 'capture predates completion',
      })
    }
  })

export type IsolatedRestoreMigrationEvidence = z.infer<
  typeof isolatedRestoreMigrationEvidenceSchema
>

export function parseIsolatedRestoreMigrationEvidence(
  content: string,
): CanonicalReleaseEvidenceParseResult<IsolatedRestoreMigrationEvidence> {
  return parseCanonicalReleaseEvidence({
    content,
    schema: isolatedRestoreMigrationEvidenceSchema,
    label: 'Isolated restore migration evidence',
  })
}
