/**
 * The gate id → live-evidence parser table.
 *
 * Gate F consults exactly this map. Adding a Gate F key without adding a
 * parser here leaves that key accepting opaque bytes again, so the Gate F test
 * suite asserts the map covers every id it is responsible for.
 */

import type { ReleaseCandidateBinding } from '../candidate-bound-evidence'
import { parseCleanCiRunEvidence } from './clean-ci-run'
import { parseCohortReadinessEvidence } from './cohort-readiness'
import { parseDefectDispositionEvidence } from './defect-disposition'
import { parseIndependentReviewEvidence } from './independent-review'
import { parseIsolatedRestoreMigrationEvidence } from './isolated-restore-migration'
import { parseLiveProviderMatrixEvidence } from './live-provider-matrix'
import {
  PREPRODUCTION_JOURNEY_GATE_CLASS,
  parsePreproductionJourneyEvidence,
} from './preproduction-journey-evidence'
import { parseTelemetryContentInspectionEvidence } from './telemetry-content-inspection'

export * from './backup-pitr-receipt'
export * from './clean-ci-run'
export * from './cohort-readiness'
export * from './common'
export * from './defect-disposition'
export * from './independent-review'
export * from './isolated-restore-migration'
export * from './live-provider-matrix'
export * from './preproduction-journey-evidence'
export * from './telemetry-content-inspection'

import { parseBackupPitrReceiptEvidence } from './backup-pitr-receipt'

/** The subset of every live artifact Gate F reasons about generically. */
export type LiveEvidenceFacts = Readonly<{
  candidate: ReleaseCandidateBinding
  capturedAt: string
  expiresAt: string
  outcome: 'passed' | 'failed'
  authority: Readonly<{ sourceArtifactSha256: string }>
  redaction: Readonly<{ reportSha256: string }>
}>

export type LiveEvidenceParseResult =
  | Readonly<{
      ok: true
      evidence: LiveEvidenceFacts
      /** Digests the owning gate must retain, so the sources cannot vanish. */
      dependencyDigests: readonly string[]
    }>
  | Readonly<{ ok: false; errors: readonly string[] }>

type LiveEvidenceParser = (content: string) => LiveEvidenceParseResult

function narrow<T extends LiveEvidenceFacts>(
  parse: (
    content: string,
  ) =>
    | Readonly<{ ok: true; evidence: T; digest: string }>
    | Readonly<{ ok: false; errors: readonly string[] }>,
): LiveEvidenceParser {
  return (content) => {
    const parsed = parse(content)
    if (!parsed.ok) return parsed
    return {
      ok: true,
      evidence: parsed.evidence,
      dependencyDigests: [
        parsed.evidence.authority.sourceArtifactSha256,
        parsed.evidence.redaction.reportSha256,
      ],
    }
  }
}

export const LIVE_EVIDENCE_PARSERS = Object.freeze({
  'candidate.clean_ci': narrow(parseCleanCiRunEvidence),
  'candidate.independent_review': narrow(parseIndependentReviewEvidence),
  'candidate.defect_disposition': narrow(parseDefectDispositionEvidence),
  'preproduction.isolated_restore_migration': narrow(
    parseIsolatedRestoreMigrationEvidence,
  ),
  'preproduction.provider_stub_journeys': narrow((content: string) =>
    parsePreproductionJourneyEvidence(
      content,
      PREPRODUCTION_JOURNEY_GATE_CLASS['preproduction.provider_stub_journeys'],
    ),
  ),
  'preproduction.live_provider_journeys': narrow(parseLiveProviderMatrixEvidence),
  'preproduction.portal_privacy': narrow((content: string) =>
    parsePreproductionJourneyEvidence(
      content,
      PREPRODUCTION_JOURNEY_GATE_CLASS['preproduction.portal_privacy'],
    ),
  ),
  'preproduction.manager_journeys': narrow((content: string) =>
    parsePreproductionJourneyEvidence(
      content,
      PREPRODUCTION_JOURNEY_GATE_CLASS['preproduction.manager_journeys'],
    ),
  ),
  'preproduction.observability_content_inspection': narrow(
    parseTelemetryContentInspectionEvidence,
  ),
  'promotion.backup_pitr': narrow(parseBackupPitrReceiptEvidence),
  'opening.cohort_readiness': narrow(parseCohortReadinessEvidence),
} as const satisfies Readonly<Record<string, LiveEvidenceParser>>)

export type LiveEvidenceGateId = keyof typeof LIVE_EVIDENCE_PARSERS

export const LIVE_EVIDENCE_GATE_IDS = Object.freeze(
  Object.keys(LIVE_EVIDENCE_PARSERS).sort() as LiveEvidenceGateId[],
)

export function isLiveEvidenceGateId(value: string): value is LiveEvidenceGateId {
  return Object.hasOwn(LIVE_EVIDENCE_PARSERS, value)
}
