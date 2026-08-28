/**
 * `candidate.independent_review` — the human review of the exact candidate.
 *
 * "Independent" is the whole claim, so it is the thing enforced: the reviewer
 * may not be an author of any reviewed change, and the review must cover the
 * candidate SHA rather than an earlier revision of the same branch.
 */

import { z } from 'zod/v4'
import {
  parseCanonicalReleaseEvidence,
  releaseEvidenceIdentitySchema,
  releaseEvidenceSourceRevisionSchema,
  releaseEvidenceTimestampSchema,
  type CanonicalReleaseEvidenceParseResult,
} from '../candidate-bound-evidence'
import {
  LIVE_EVIDENCE_VERSIONS,
  liveEvidenceBaseSchema,
  liveEvidenceCommonIssues,
  liveEvidenceTextSchema,
} from './common'

export const INDEPENDENT_REVIEW_EVIDENCE_VERSION =
  LIVE_EVIDENCE_VERSIONS['candidate.independent_review']

const reviewedChangeSchema = z
  .object({
    reference: liveEvidenceTextSchema,
    headSha: releaseEvidenceSourceRevisionSchema,
    authorIdentity: releaseEvidenceIdentitySchema,
    approvedAt: releaseEvidenceTimestampSchema,
  })
  .strict()

const independentReviewEvidenceSchema = liveEvidenceBaseSchema(
  INDEPENDENT_REVIEW_EVIDENCE_VERSION,
  'independent-review',
)
  .extend({
    reviewerIdentity: releaseEvidenceIdentitySchema,
    reviewedSha: releaseEvidenceSourceRevisionSchema,
    reviewedAt: releaseEvidenceTimestampSchema,
    changes: z.array(reviewedChangeSchema).min(1),
    unresolvedComments: z.number().int().safe().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    liveEvidenceCommonIssues(value, context)
    if (value.reviewedSha !== value.candidate.releaseSha) {
      context.addIssue({
        code: 'custom',
        path: ['reviewedSha'],
        message: 'the review must cover the candidate release SHA',
      })
    }
    for (const [index, change] of value.changes.entries()) {
      if (change.authorIdentity === value.reviewerIdentity) {
        context.addIssue({
          code: 'custom',
          path: ['changes', index, 'authorIdentity'],
          message: 'the reviewer cannot be an author of a reviewed change',
        })
      }
    }
    if (value.outcome === 'passed' && value.unresolvedComments !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['unresolvedComments'],
        message: 'passed review requires zero unresolved comments',
      })
    }
    if (Date.parse(value.capturedAt) < Date.parse(value.reviewedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['capturedAt'],
        message: 'capture predates the review',
      })
    }
  })

export type IndependentReviewEvidence = z.infer<typeof independentReviewEvidenceSchema>

export function parseIndependentReviewEvidence(
  content: string,
): CanonicalReleaseEvidenceParseResult<IndependentReviewEvidence> {
  return parseCanonicalReleaseEvidence({
    content,
    schema: independentReviewEvidenceSchema,
    label: 'Independent review evidence',
  })
}
