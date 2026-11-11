import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'

export const REVIEW_LIFECYCLE_RECOVERY_APPROVAL_VERSION =
  'review-lifecycle-recovery-approval-v1' as const

const SHA = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,254}$/u

const instant = z.iso.datetime({ offset: true })
const sha = z.string().regex(SHA)
const sha256 = z.string().regex(SHA256)
const subject = z.string().regex(SUBJECT)
const postgresPositiveInteger = z.number().int().positive().max(2_147_483_647)

const requestSchema = z
  .object({
    version: z.literal(REVIEW_LIFECYCLE_RECOVERY_APPROVAL_VERSION),
    kind: z.literal('review-lifecycle-recovery'),
    target: z
      .object({
        releaseSha: sha,
        releaseManifestSha256: sha256,
        restorePointAt: instant,
        restoreDatabaseServiceName: subject,
        railwayProjectId: subject.nullable(),
        railwayEnvironmentId: subject.nullable(),
        recoveryRunId: z.uuid(),
        recoveryGeneration: postgresPositiveInteger,
      })
      .strict(),
    lifecycle: z
      .object({
        contract: z.literal('review-source-content-lifecycle-v1'),
        scope: z.object({ kind: z.literal('expired') }).strict(),
        evaluatedAt: instant,
        batchSize: z.literal(100),
        sourcePolicyVersion: postgresPositiveInteger,
        retentionPolicyVersion: postgresPositiveInteger,
        policySha256: sha256,
        reportSha256: sha256,
      })
      .strict(),
  })
  .strict()

export type ReviewLifecycleRecoveryApprovalRequest = z.infer<typeof requestSchema>

/** Runtime-only facts supplied by the isolated restore verifier. */
export type ReviewLifecycleRecoveryRuntimeTarget = Readonly<{
  releaseSha: string
  releaseManifestSha256: string
  restorePointAt: Date
  restoreDatabaseServiceName: string
  railwayProjectId: string | null
  railwayEnvironmentId: string | null
  operatorId: string
  correlationId: string
}>

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function canonicalDocument(value: unknown): string {
  return `${canonicalizeRfc8785(value)}\n`
}

function reviewLifecycleRecoveryApprovalRequestSha256(
  request: ReviewLifecycleRecoveryApprovalRequest,
): string {
  return sha256Hex(canonicalizeRfc8785(request))
}

/** Runtime-validate and canonicalize a report-first request artifact. */
export function createReviewLifecycleRecoveryApprovalRequest(input: unknown): Readonly<{
  request: ReviewLifecycleRecoveryApprovalRequest
  content: string
  sha256: string
}> {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error('Review lifecycle recovery approval request is invalid')
  }
  return {
    request: parsed.data,
    content: canonicalDocument(parsed.data),
    sha256: reviewLifecycleRecoveryApprovalRequestSha256(parsed.data),
  }
}
