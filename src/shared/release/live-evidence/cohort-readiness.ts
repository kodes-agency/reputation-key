/**
 * `opening.cohort_readiness` — the bounded first cohort is real, named
 * internally, and pseudonymous externally.
 *
 * Two opposite failures are refused here. The first is a cohort nobody owns:
 * "we will open to a design partner" with no support owner and no incident
 * owner is not readiness. The second is the privacy failure that the obvious
 * fix causes — writing the design partner's legal name and a contact email
 * into an evidence bundle that is then circulated for approval. The cohort is
 * therefore identified by a PSEUDONYM whose mapping lives outside this
 * repository, and the artifact refuses anything that looks like a real
 * organization name or an email address.
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
  isDirectlyIdentifying,
  liveEvidenceBaseSchema,
  liveEvidenceCommonIssues,
  liveEvidenceTextSchema,
} from './common'

export const COHORT_READINESS_EVIDENCE_VERSION =
  LIVE_EVIDENCE_VERSIONS['opening.cohort_readiness']

/**
 * The only shape a cohort reference may take. Anything with whitespace, an
 * `@`, or a corporate suffix is a real-world identity and is refused by
 * construction rather than by a blocklist.
 */
const COHORT_PSEUDONYM_PATTERN = /^design-partner-[0-9a-f]{8}$/u

/** Corporate suffixes that betray a legal name even inside a slug. */
const LEGAL_NAME_MARKERS = [
  ' inc',
  ' inc.',
  ' llc',
  ' ltd',
  ' limited',
  ' gmbh',
  ' corp',
  ' corporation',
  ' co.',
  ' s.a.',
  ' b.v.',
] as const

function looksLikeOrganizationName(value: string): boolean {
  const normalized = ` ${value.trim().toLowerCase()} `
  return LEGAL_NAME_MARKERS.some((marker) => normalized.includes(`${marker} `))
}

const readinessCheckSchema = z
  .object({
    name: liveEvidenceTextSchema,
    satisfied: z.boolean(),
    evidenceSha256: releaseEvidenceSha256Schema,
  })
  .strict()

/** Nothing may open without all of these being true. */
export const COHORT_READINESS_CHECKS = [
  'support_channel_staffed',
  'incident_escalation_rehearsed',
  'agreement_countersigned',
  'onboarding_runbook_reviewed',
  'exit_and_data_deletion_path_confirmed',
] as const

const cohortReadinessEvidenceSchema = liveEvidenceBaseSchema(
  COHORT_READINESS_EVIDENCE_VERSION,
  'cohort-readiness',
)
  .extend({
    kind: z.literal('design_partner'),
    cohortReference: z.string().regex(COHORT_PSEUDONYM_PATTERN),
    cohortReferenceSha256: releaseEvidenceSha256Schema,
    /** Where the pseudonym→organization mapping is held. Never the mapping. */
    pseudonymMappingCustodian: releaseEvidenceIdentitySchema,
    organizationCount: z.literal(1),
    seatCount: z.number().int().safe().positive().max(50),
    supportOwner: releaseEvidenceIdentitySchema,
    incidentOwner: releaseEvidenceIdentitySchema,
    changeRecord: releaseEvidenceIdentitySchema,
    openingWindow: z
      .object({
        opensAt: releaseEvidenceTimestampSchema,
        reviewAt: releaseEvidenceTimestampSchema,
      })
      .strict(),
    checks: z.array(readinessCheckSchema).min(COHORT_READINESS_CHECKS.length),
  })
  .strict()
  .superRefine((value, context) => {
    liveEvidenceCommonIssues(value, context)

    const identityFields = [
      ['cohortReference', value.cohortReference],
      ['pseudonymMappingCustodian', value.pseudonymMappingCustodian],
      ['supportOwner', value.supportOwner],
      ['incidentOwner', value.incidentOwner],
    ] as const
    for (const [field, identity] of identityFields) {
      if (isDirectlyIdentifying(identity)) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} must not contain an email address`,
        })
      }
    }
    if (looksLikeOrganizationName(value.cohortReference)) {
      context.addIssue({
        code: 'custom',
        path: ['cohortReference'],
        message: 'cohortReference must be a pseudonym, not an organization name',
      })
    }
    if (value.supportOwner === value.incidentOwner) {
      context.addIssue({
        code: 'custom',
        path: ['incidentOwner'],
        message: 'support and incident ownership must be separately named',
      })
    }

    const named = value.checks.map(({ name }) => name)
    if (new Set(named).size !== named.length) {
      context.addIssue({
        code: 'custom',
        path: ['checks'],
        message: 'duplicate readiness check',
      })
    }
    for (const required of COHORT_READINESS_CHECKS) {
      if (!named.includes(required)) {
        context.addIssue({
          code: 'custom',
          path: ['checks'],
          message: `missing required readiness check ${required}`,
        })
      }
    }
    if (value.outcome === 'passed') {
      for (const [index, check] of value.checks.entries()) {
        if (!check.satisfied) {
          context.addIssue({
            code: 'custom',
            path: ['checks', index, 'satisfied'],
            message: `readiness check ${check.name} is not satisfied`,
          })
        }
      }
    }
    if (
      Date.parse(value.openingWindow.reviewAt) <= Date.parse(value.openingWindow.opensAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['openingWindow', 'reviewAt'],
        message: 'the cohort review must postdate opening',
      })
    }
  })

export type CohortReadinessEvidence = z.infer<typeof cohortReadinessEvidenceSchema>

export function parseCohortReadinessEvidence(
  content: string,
): CanonicalReleaseEvidenceParseResult<CohortReadinessEvidence> {
  return parseCanonicalReleaseEvidence({
    content,
    schema: cohortReadinessEvidenceSchema,
    label: 'Cohort readiness evidence',
  })
}
