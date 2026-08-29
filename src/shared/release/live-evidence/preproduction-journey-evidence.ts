/**
 * The three pre-production journey gates that run against PROVIDER STUBS:
 * `preproduction.provider_stub_journeys`, `preproduction.portal_privacy`, and
 * `preproduction.manager_journeys`.
 *
 * `providerMode` is a hard literal `'stub'` here and a hard literal `'live'`
 * in `live-provider-matrix.ts`. That is the point: program §REL-01
 * pre-production step 2 requires the live-provider matrix as evidence
 * SEPARATE from the stub suite, and a shared optional enum would let a stub
 * run be filed under the live gate by editing one string. Two schemas that
 * cannot parse each other's bytes make that substitution impossible.
 *
 * `journeyClass` is the second discriminator, so the portal-privacy artifact
 * cannot be filed as the manager artifact either.
 */

import { z } from 'zod/v4'
import {
  parseCanonicalReleaseEvidence,
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

export const PREPRODUCTION_JOURNEY_EVIDENCE_VERSION =
  LIVE_EVIDENCE_VERSIONS['preproduction.provider_stub_journeys']

const PREPRODUCTION_JOURNEY_CLASSES = [
  'provider_stub',
  'portal_privacy',
  'manager',
] as const
export type PreproductionJourneyClass = (typeof PREPRODUCTION_JOURNEY_CLASSES)[number]

/** Gate id ↔ journey class, so a class cannot be filed under the wrong gate. */
export const PREPRODUCTION_JOURNEY_GATE_CLASS = {
  'preproduction.provider_stub_journeys': 'provider_stub',
  'preproduction.portal_privacy': 'portal_privacy',
  'preproduction.manager_journeys': 'manager',
} as const satisfies Readonly<Record<string, PreproductionJourneyClass>>

/**
 * Capability tokens that must remain unreachable in beta. A journey that
 * claims to have EXERCISED one of them is either testing a surface that must
 * not exist or mislabelling a journey; either way it cannot be release
 * evidence.
 */
const DARK_SURFACE_TOKENS = [
  'portal.upload',
  'portal.guest_contact',
  'portal.guest_media',
  'badge.use',
  'leaderboard.use',
  'team.use',
  'billing',
  'bulk_close',
  'staff_user_login',
  'mfa',
] as const

const journeyResultSchema = z
  .object({
    journeyId: liveEvidenceTextSchema,
    title: liveEvidenceTextSchema,
    outcome: z.enum(['passed', 'failed', 'timed_out', 'interrupted']),
    durationMs: z.number().int().safe().nonnegative(),
  })
  .strict()

const preproductionJourneyEvidenceSchema = liveEvidenceBaseSchema(
  PREPRODUCTION_JOURNEY_EVIDENCE_VERSION,
  'preproduction-journeys',
)
  .extend({
    journeyClass: z.enum(PREPRODUCTION_JOURNEY_CLASSES),
    providerMode: z.literal('stub'),
    environmentClass: z.literal('preproduction'),
    startedAt: releaseEvidenceTimestampSchema,
    completedAt: releaseEvidenceTimestampSchema,
    runner: z
      .object({
        kind: z.literal('playwright'),
        specSha256: releaseEvidenceSha256Schema,
        packageVersion: z.string().trim().min(1).max(64),
        attempts: z.literal(1),
        retries: z.literal(0),
      })
      .strict(),
    results: z.array(journeyResultSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    liveEvidenceCommonIssues(value, context)
    const ids = value.results.map(({ journeyId }) => journeyId)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['results'],
        message: 'duplicate journey id',
      })
    }
    for (const [index, result] of value.results.entries()) {
      const normalized = result.journeyId.toLowerCase()
      const dark = DARK_SURFACE_TOKENS.find((token) => normalized.includes(token))
      if (dark) {
        context.addIssue({
          code: 'custom',
          path: ['results', index, 'journeyId'],
          message: `journey exercises dark capability ${dark}, which must stay unreachable in beta`,
        })
      }
      if (value.outcome === 'passed' && result.outcome !== 'passed') {
        context.addIssue({
          code: 'custom',
          path: ['results', index, 'outcome'],
          message: `journey ${result.journeyId} did not pass`,
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

export type PreproductionJourneyEvidence = z.infer<
  typeof preproductionJourneyEvidenceSchema
>

export function parsePreproductionJourneyEvidence(
  content: string,
  expectedClass?: PreproductionJourneyClass,
): CanonicalReleaseEvidenceParseResult<PreproductionJourneyEvidence> {
  const parsed = parseCanonicalReleaseEvidence({
    content,
    schema: preproductionJourneyEvidenceSchema,
    label: 'Pre-production journey evidence',
  })
  if (!parsed.ok || expectedClass === undefined) return parsed
  if (parsed.evidence.journeyClass !== expectedClass) {
    return {
      ok: false,
      errors: [
        `journeyClass: expected ${expectedClass} for this gate, found ${parsed.evidence.journeyClass}`,
      ],
    }
  }
  return parsed
}
