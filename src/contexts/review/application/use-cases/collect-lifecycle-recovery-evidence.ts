import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { createGoogleSourceContentPolicy } from '#/shared/domain/source-content-policy'
import { collectReviewSourceContentLifecycleReport } from './collect-source-content-lifecycle-report'
import {
  REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
  REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE,
  REVIEW_SOURCE_CONTENT_LIFECYCLE_RETENTION_POLICY_VERSION,
  type RunReviewSourceContentLifecycle,
} from './run-source-content-lifecycle'

export const REVIEW_LIFECYCLE_RECOVERY_REPORT_VERSION =
  'review-lifecycle-recovery-report-v1' as const

const GLOBAL_EXPIRED_SCOPE = Object.freeze({ kind: 'expired' as const })

const policyBinding = () => {
  const sourcePolicy = createGoogleSourceContentPolicy()
  return {
    contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
    sourcePolicy,
    retentionPolicyVersion: REVIEW_SOURCE_CONTENT_LIFECYCLE_RETENTION_POLICY_VERSION,
    scope: GLOBAL_EXPIRED_SCOPE,
    batchSize: REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE,
  } as const
}

export function reviewLifecyclePolicySha256(): string {
  return createHash('sha256')
    .update(canonicalizeRfc8785(policyBinding()), 'utf8')
    .digest('hex')
}

export type ReviewLifecycleRecoveryReport = Readonly<{
  version: typeof REVIEW_LIFECYCLE_RECOVERY_REPORT_VERSION
  contract: typeof REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT
  scope: typeof GLOBAL_EXPIRED_SCOPE
  evaluatedAt: string
  batchSize: typeof REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE
  sourcePolicyVersion: number
  retentionPolicyVersion: number
  policySha256: string
  pages: Readonly<{ report: number; shadow: number }>
  scanned: Readonly<{ report: number; shadow: number }>
  lifecycle: Readonly<{
    eligible: number
    expired: number
    tombstone: number
    unverifiable: number
  }>
  shadow: NonNullable<
    Awaited<ReturnType<typeof collectReviewSourceContentLifecycleReport>>['shadow']
  >
}>

/**
 * Collect the complete report and shadow views over one injected frozen clock.
 * The resulting evidence is aggregate-only; drifted Review IDs never cross
 * this recovery approval boundary.
 */
export async function collectReviewLifecycleRecoveryEvidence(
  runLifecycle: RunReviewSourceContentLifecycle,
): Promise<Readonly<{ report: ReviewLifecycleRecoveryReport; sha256: string }>> {
  const report = await collectReviewSourceContentLifecycleReport(runLifecycle, {
    mode: 'report',
    batchSize: REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE,
  })
  const shadow = await collectReviewSourceContentLifecycleReport(runLifecycle, {
    mode: 'shadow',
    batchSize: REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE,
  })
  if (
    report.evaluatedAt !== shadow.evaluatedAt ||
    canonicalizeRfc8785(report.scope) !== canonicalizeRfc8785(shadow.scope) ||
    canonicalizeRfc8785(report.lifecycle) !== canonicalizeRfc8785(shadow.lifecycle)
  ) {
    throw new Error('Review lifecycle recovery report window changed during inspection')
  }
  if (shadow.shadow == null) {
    throw new Error('Review lifecycle recovery shadow evidence is missing')
  }
  const sourcePolicy = createGoogleSourceContentPolicy()
  const evidence: ReviewLifecycleRecoveryReport = {
    version: REVIEW_LIFECYCLE_RECOVERY_REPORT_VERSION,
    contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
    scope: GLOBAL_EXPIRED_SCOPE,
    evaluatedAt: report.evaluatedAt,
    batchSize: REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE,
    sourcePolicyVersion: sourcePolicy.policyVersion,
    retentionPolicyVersion: REVIEW_SOURCE_CONTENT_LIFECYCLE_RETENTION_POLICY_VERSION,
    policySha256: reviewLifecyclePolicySha256(),
    pages: { report: report.pages, shadow: shadow.pages },
    scanned: { report: report.scanned, shadow: shadow.scanned },
    lifecycle: report.lifecycle,
    shadow: shadow.shadow,
  }
  return {
    report: evidence,
    sha256: createHash('sha256')
      .update(canonicalizeRfc8785(evidence), 'utf8')
      .digest('hex'),
  }
}
