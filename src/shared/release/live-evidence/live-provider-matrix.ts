/**
 * `preproduction.live_provider_journeys` — the matrix run against the REAL
 * Google provider, not the stub.
 *
 * `providerMode` is a hard literal `'live'`. The stub producer
 * (`preproduction-journey-evidence.ts`) pins `'stub'` just as hard, so the two
 * evidence classes are structurally disjoint: no field edit turns a stub run
 * into live-provider evidence, and no stub artifact parses here at all.
 *
 * The remaining live-only facts are the ones a stub cannot produce: a real
 * provider account reference, real quota/error observation, and an egress
 * gateway attestation proving the traffic actually left through the
 * controlled path.
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

export const LIVE_PROVIDER_MATRIX_EVIDENCE_VERSION =
  LIVE_EVIDENCE_VERSIONS['preproduction.live_provider_journeys']

/** The provider surfaces the beta actually depends on. */
export const LIVE_PROVIDER_SURFACES = [
  'account_listing',
  'location_listing',
  'review_sync',
  'reply_publish',
  'media_read',
  'token_refresh',
] as const

const surfaceResultSchema = z
  .object({
    surface: z.enum(LIVE_PROVIDER_SURFACES),
    requestCount: z.number().int().safe().positive(),
    providerErrorCount: z.number().int().safe().nonnegative(),
    quotaExhaustedCount: z.number().int().safe().nonnegative(),
    outcome: z.enum(['passed', 'failed']),
    observedAt: releaseEvidenceTimestampSchema,
  })
  .strict()

const liveProviderMatrixEvidenceSchema = liveEvidenceBaseSchema(
  LIVE_PROVIDER_MATRIX_EVIDENCE_VERSION,
  'live-provider-matrix',
)
  .extend({
    providerMode: z.literal('live'),
    provider: z.literal('google_business_profile'),
    startedAt: releaseEvidenceTimestampSchema,
    completedAt: releaseEvidenceTimestampSchema,
    account: z
      .object({
        providerAccountRef: releaseEvidenceIdentitySchema,
        consentArtifactSha256: releaseEvidenceSha256Schema,
        approvedBy: releaseEvidenceIdentitySchema,
        approvedAt: releaseEvidenceTimestampSchema,
      })
      .strict(),
    egress: z
      .object({
        gatewayAttestationSha256: releaseEvidenceSha256Schema,
        offGatewayRequestCount: z.literal(0),
        summary: liveEvidenceTextSchema,
      })
      .strict(),
    surfaces: z.array(surfaceResultSchema).min(LIVE_PROVIDER_SURFACES.length),
  })
  .strict()
  .superRefine((value, context) => {
    liveEvidenceCommonIssues(value, context)
    const observed = value.surfaces.map(({ surface }) => surface)
    if (new Set(observed).size !== observed.length) {
      context.addIssue({
        code: 'custom',
        path: ['surfaces'],
        message: 'duplicate provider surface',
      })
    }
    for (const surface of LIVE_PROVIDER_SURFACES) {
      if (!observed.includes(surface)) {
        context.addIssue({
          code: 'custom',
          path: ['surfaces'],
          message: `missing required live provider surface ${surface}`,
        })
      }
    }
    if (value.outcome === 'passed') {
      for (const [index, surface] of value.surfaces.entries()) {
        if (surface.outcome !== 'passed') {
          context.addIssue({
            code: 'custom',
            path: ['surfaces', index, 'outcome'],
            message: `live provider surface ${surface.surface} did not pass`,
          })
        }
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

export type LiveProviderMatrixEvidence = z.infer<typeof liveProviderMatrixEvidenceSchema>

export function parseLiveProviderMatrixEvidence(
  content: string,
): CanonicalReleaseEvidenceParseResult<LiveProviderMatrixEvidence> {
  return parseCanonicalReleaseEvidence({
    content,
    schema: liveProviderMatrixEvidenceSchema,
    label: 'Live provider matrix evidence',
  })
}
