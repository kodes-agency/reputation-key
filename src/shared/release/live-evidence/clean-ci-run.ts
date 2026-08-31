/**
 * `candidate.clean_ci` — the required-gate run that produced this candidate.
 *
 * "Clean" is a stronger claim than "green": a re-run that passed on attempt 3,
 * or a run where a required job was skipped because a path filter excluded it,
 * is not clean. Both are representable in a GitHub check summary and neither
 * is acceptable, so both are refused structurally here.
 */

import { z } from 'zod/v4'
import {
  parseCanonicalReleaseEvidence,
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

export const CLEAN_CI_RUN_EVIDENCE_VERSION = LIVE_EVIDENCE_VERSIONS['candidate.clean_ci']

/**
 * The one workflow identity allowed to attest a release candidate. A run from
 * a fork, a branch, or a different workflow file is a different trust domain
 * even when the job names match.
 */
export const RELEASE_IMAGES_WORKFLOW_REF =
  'https://github.com/kodes-agency/reputation-key/.github/workflows/release-images.yml@refs/heads/main' as const

const jobSchema = z
  .object({
    name: liveEvidenceTextSchema,
    required: z.boolean(),
    conclusion: z.enum(['success', 'failure', 'cancelled', 'skipped', 'timed_out']),
  })
  .strict()

const cleanCiRunEvidenceSchema = liveEvidenceBaseSchema(
  CLEAN_CI_RUN_EVIDENCE_VERSION,
  'clean-ci-run',
)
  .extend({
    workflowRef: z.literal(RELEASE_IMAGES_WORKFLOW_REF),
    workflowRunId: z.string().regex(/^[0-9]{1,20}$/u),
    workflowRunUrl: z
      .string()
      .max(512)
      .refine(
        (value) =>
          value.startsWith(
            'https://github.com/kodes-agency/reputation-key/actions/runs/',
          ),
        'must be a run URL in the release repository',
      ),
    runAttempt: z.literal(1),
    headSha: releaseEvidenceSourceRevisionSchema,
    startedAt: releaseEvidenceTimestampSchema,
    completedAt: releaseEvidenceTimestampSchema,
    jobs: z.array(jobSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    liveEvidenceCommonIssues(value, context)
    if (value.headSha !== value.candidate.releaseSha) {
      context.addIssue({
        code: 'custom',
        path: ['headSha'],
        message: 'the attested run must be the candidate release SHA',
      })
    }
    const names = value.jobs.map(({ name }) => name)
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: 'custom', path: ['jobs'], message: 'duplicate job name' })
    }
    const required = value.jobs.filter(({ required: isRequired }) => isRequired)
    if (required.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['jobs'],
        message: 'at least one required job must be attested',
      })
    }
    for (const [index, job] of value.jobs.entries()) {
      if (job.required && job.conclusion === 'skipped') {
        context.addIssue({
          code: 'custom',
          path: ['jobs', index, 'conclusion'],
          message: `required job ${job.name} was skipped; a skipped required job is not a clean run`,
        })
      }
      if (job.required && job.conclusion !== 'success' && value.outcome === 'passed') {
        context.addIssue({
          code: 'custom',
          path: ['jobs', index, 'conclusion'],
          message: `required job ${job.name} did not succeed`,
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
        message: 'capture predates the attested run',
      })
    }
  })

export type CleanCiRunEvidence = z.infer<typeof cleanCiRunEvidenceSchema>

export function parseCleanCiRunEvidence(
  content: string,
): CanonicalReleaseEvidenceParseResult<CleanCiRunEvidence> {
  return parseCanonicalReleaseEvidence({
    content,
    schema: cleanCiRunEvidenceSchema,
    label: 'Clean CI run evidence',
  })
}
