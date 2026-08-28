/**
 * `candidate.defect_disposition` — every known defect has a NAMED decision.
 *
 * The failure this refuses is the silent one: a defect register exported with
 * rows that have no disposition at all, or a blocking severity "deferred" by
 * nobody in particular. Every row must carry a decision, a decider, and — for
 * anything deferred — the release it is deferred to.
 */

import { z } from 'zod/v4'
import {
  parseCanonicalReleaseEvidence,
  releaseEvidenceIdentitySchema,
  releaseEvidenceTimestampSchema,
  type CanonicalReleaseEvidenceParseResult,
} from '../candidate-bound-evidence'
import {
  LIVE_EVIDENCE_VERSIONS,
  liveEvidenceBaseSchema,
  liveEvidenceCommonIssues,
  liveEvidenceTextSchema,
} from './common'

export const DEFECT_DISPOSITION_EVIDENCE_VERSION =
  LIVE_EVIDENCE_VERSIONS['candidate.defect_disposition']

export const DEFECT_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export const DEFECT_DISPOSITIONS = [
  'fixed_in_candidate',
  'accepted_risk',
  'deferred',
  'not_a_defect',
] as const

const defectSchema = z
  .object({
    id: liveEvidenceTextSchema,
    title: liveEvidenceTextSchema,
    severity: z.enum(DEFECT_SEVERITIES),
    protectedSurfaceReachable: z.boolean(),
    disposition: z.enum(DEFECT_DISPOSITIONS),
    decidedBy: releaseEvidenceIdentitySchema,
    decidedAt: releaseEvidenceTimestampSchema,
    rationale: liveEvidenceTextSchema,
    deferredToRelease: liveEvidenceTextSchema.nullable(),
  })
  .strict()

const defectDispositionEvidenceSchema = liveEvidenceBaseSchema(
  DEFECT_DISPOSITION_EVIDENCE_VERSION,
  'defect-disposition',
)
  .extend({
    registerSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    defects: z.array(defectSchema),
  })
  .strict()
  .superRefine((value, context) => {
    liveEvidenceCommonIssues(value, context)
    const ids = value.defects.map(({ id }) => id)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['defects'],
        message: 'duplicate defect id',
      })
    }
    for (const [index, defect] of value.defects.entries()) {
      if (defect.disposition === 'deferred' && defect.deferredToRelease === null) {
        context.addIssue({
          code: 'custom',
          path: ['defects', index, 'deferredToRelease'],
          message: `defect ${defect.id} is deferred without a target release`,
        })
      }
      if (defect.disposition !== 'deferred' && defect.deferredToRelease !== null) {
        context.addIssue({
          code: 'custom',
          path: ['defects', index, 'deferredToRelease'],
          message: `defect ${defect.id} names a deferral target but is not deferred`,
        })
      }
      // Gate F separately asserts protectedReachableHighCount === 0. A
      // protected-surface-reachable High or Critical accepted as risk here
      // would contradict that index field, so it cannot pass.
      const blocking =
        defect.protectedSurfaceReachable &&
        (defect.severity === 'critical' || defect.severity === 'high')
      if (
        blocking &&
        value.outcome === 'passed' &&
        defect.disposition !== 'fixed_in_candidate' &&
        defect.disposition !== 'not_a_defect'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['defects', index, 'disposition'],
          message: `defect ${defect.id} is a protected-surface-reachable ${defect.severity} and cannot be deferred or accepted`,
        })
      }
      if (Date.parse(value.capturedAt) < Date.parse(defect.decidedAt)) {
        context.addIssue({
          code: 'custom',
          path: ['capturedAt'],
          message: 'capture predates a defect decision',
        })
      }
    }
  })

export type DefectDispositionEvidence = z.infer<typeof defectDispositionEvidenceSchema>

export function parseDefectDispositionEvidence(
  content: string,
): CanonicalReleaseEvidenceParseResult<DefectDispositionEvidence> {
  return parseCanonicalReleaseEvidence({
    content,
    schema: defectDispositionEvidenceSchema,
    label: 'Defect disposition evidence',
  })
}
