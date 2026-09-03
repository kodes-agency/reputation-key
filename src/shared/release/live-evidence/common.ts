/**
 * Shared shape for every NORMALIZED live-evidence importer (REL-01-T6).
 *
 * Before this module, fifteen of the eighteen Gate F keys accepted any opaque
 * file whose digest matched the index. `{"status":"passed"}` was a valid
 * "clean CI run", a valid "independent review", and a valid "backup/PITR
 * receipt". The digest proved only that nobody edited the placeholder.
 *
 * Every importer below turns an operator's captured output into a typed
 * artifact that carries:
 *
 * - the same `ReleaseCandidateBinding` as every other live promotion proof, so
 *   evidence captured against another SHA, project, or environment cannot be
 *   relabelled for this candidate;
 * - `capturedAt` and `expiresAt`, so Gate F can refuse a stale proof rather
 *   than carrying last month's receipt forward;
 * - an attributable authority (who captured it, who countersigned it, under
 *   which change record) — an unattributable capture is not evidence;
 * - redaction counters, because a proof that leaks customer content into the
 *   evidence bundle is itself a privacy incident;
 * - `outcome` + `failures`, where `passed` is only representable when nothing
 *   failed.
 *
 * The importers NEVER default a missing field. An absent value is a hard
 * parse failure, not a zero.
 */

import { z } from 'zod/v4'
import { CURRENT_RELEASE_POSTURE } from '../gate-policy'
import {
  releaseCandidateBindingSchema,
  releaseEvidenceIdentitySchema,
  releaseEvidenceSha256Schema,
  releaseEvidenceTimestampSchema,
} from '../candidate-bound-evidence'

/** Every importer version literal, so callers can enumerate the family. */
export const LIVE_EVIDENCE_VERSIONS = {
  'candidate.clean_ci': 'repkey-clean-ci-run-1',
  'candidate.independent_review': 'repkey-independent-review-1',
  'candidate.defect_disposition': 'repkey-defect-disposition-1',
  'preproduction.isolated_restore_migration': 'repkey-isolated-restore-migration-1',
  'preproduction.provider_stub_journeys': 'repkey-preproduction-journeys-1',
  'preproduction.portal_privacy': 'repkey-preproduction-journeys-1',
  'preproduction.manager_journeys': 'repkey-preproduction-journeys-1',
  'preproduction.live_provider_journeys': 'repkey-live-provider-matrix-1',
  'preproduction.observability_content_inspection':
    'repkey-telemetry-content-inspection-1',
  'promotion.backup_pitr': 'repkey-backup-pitr-receipt-1',
  'opening.cohort_readiness': 'repkey-cohort-readiness-1',
} as const

export const liveEvidenceTextSchema = z.string().trim().min(1).max(1024)

/**
 * Who captured this, who countersigned it, and under which change record.
 * Wider-audience releases require distinct capture and attestation identities;
 * the single operator may fill both roles while the product remains closed beta.
 */
const liveEvidenceAuthoritySchema = z
  .object({
    capturedBy: releaseEvidenceIdentitySchema,
    attestedBy: releaseEvidenceIdentitySchema,
    changeRecord: releaseEvidenceIdentitySchema,
    sourceArtifactSha256: releaseEvidenceSha256Schema,
  })
  .strict()

/**
 * Redaction counters. `prohibitedFieldOccurrences` counts customer-identifying
 * fields that reached the captured artifact; a passing artifact must be zero.
 */
const liveEvidenceRedactionSchema = z
  .object({
    reportSha256: releaseEvidenceSha256Schema,
    prohibitedFieldOccurrences: z.number().int().safe().nonnegative(),
    unexpectedExternalRequests: z.number().int().safe().nonnegative(),
  })
  .strict()

const liveEvidenceFailureSchema = z.array(z.string().trim().min(1).max(1024))

/**
 * The fields every live-evidence artifact carries. Built as a factory rather
 * than a shared constant so each importer pins its own `version` and
 * `evidenceKind` literals — a defect-disposition file can never parse as a
 * clean-CI file.
 */
export function liveEvidenceBaseSchema<Version extends string, Kind extends string>(
  version: Version,
  evidenceKind: Kind,
) {
  return z.object({
    version: z.literal(version),
    evidenceKind: z.literal(evidenceKind),
    candidate: releaseCandidateBindingSchema,
    capturedAt: releaseEvidenceTimestampSchema,
    expiresAt: releaseEvidenceTimestampSchema,
    authority: liveEvidenceAuthoritySchema,
    redaction: liveEvidenceRedactionSchema,
    outcome: z.enum(['passed', 'failed']),
    failures: liveEvidenceFailureSchema,
  })
}

export type LiveEvidenceCommon = Readonly<{
  capturedAt: string
  expiresAt: string
  authority: z.infer<typeof liveEvidenceAuthoritySchema>
  redaction: z.infer<typeof liveEvidenceRedactionSchema>
  outcome: 'passed' | 'failed'
  failures: readonly string[]
}>

/**
 * The rules every importer shares. Kept in one place so a new importer cannot
 * quietly ship without them.
 */
export function liveEvidenceCommonIssues(
  value: LiveEvidenceCommon,
  context: z.RefinementCtx,
): void {
  if (
    CURRENT_RELEASE_POSTURE !== 'closed-beta' &&
    value.authority.capturedBy === value.authority.attestedBy
  ) {
    context.addIssue({
      code: 'custom',
      path: ['authority', 'attestedBy'],
      message: 'the capturing identity cannot attest its own evidence',
    })
  }
  if (Date.parse(value.expiresAt) <= Date.parse(value.capturedAt)) {
    context.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'expiry must postdate capture',
    })
  }
  if (value.outcome === 'passed') {
    if (value.failures.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'passed outcome requires an empty failure list',
      })
    }
    if (value.redaction.prohibitedFieldOccurrences !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['redaction', 'prohibitedFieldOccurrences'],
        message: 'passed outcome requires zero prohibited-field occurrences',
      })
    }
    if (value.redaction.unexpectedExternalRequests !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['redaction', 'unexpectedExternalRequests'],
        message: 'passed outcome requires zero unexpected external requests',
      })
    }
  }
  if (value.outcome === 'failed' && value.failures.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['failures'],
      message: 'failed outcome requires at least one failure',
    })
  }
}

/**
 * Identifiers that would leak a real person or customer into an evidence
 * bundle. Cohort readiness is the only artifact that names an external party,
 * and it must name a PSEUDONYM.
 */
const EMAIL = /@/u
export function isDirectlyIdentifying(value: string): boolean {
  return EMAIL.test(value)
}
