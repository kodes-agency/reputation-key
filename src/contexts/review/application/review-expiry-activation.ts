import { ReviewDestructiveLifecycleQuarantinedError } from './review-lifecycle-safety'
import type {
  AuthorizeReviewSourceContentLifecycleApply,
  ReviewSourceContentLifecycleApplyApproval,
} from './use-cases/run-source-content-lifecycle'

/** Trusted composition input, supplied only after the owner reviews the evidence.
 * No request, job payload or environment variable can supply this record. */
export type ReviewExpiryActivation = Readonly<{
  approval: ReviewSourceContentLifecycleApplyApproval
  shadowParitySha256: string
  isolatedRestoreProofSha256: string
  commandReplayProofSha256: string
  backups: Readonly<{
    verifiedAt: string
    maximumRetentionDays: number
    /** The Manual backup must have a finite lifetime too. */
    manualRetentionDays: number
  }>
}>

const SHA256 = /^[a-f0-9]{64}$/u
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000

const withinBackupCeiling = (days: number): boolean =>
  Number.isFinite(days) && days >= 0 && days <= 30

/** Age-based expiry repeats after restore, so it needs no journal per page.
 * This approval cannot authorize a one-off erasure, which needs its own journal. */
export function createAuthorizeReviewExpiryApply(
  activation?: ReviewExpiryActivation,
): AuthorizeReviewSourceContentLifecycleApply {
  return async ({ scope, evaluatedAt }) => {
    if (activation == null || scope.kind !== 'expired') {
      throw new ReviewDestructiveLifecycleQuarantinedError()
    }
    const verifiedAt = new Date(activation.backups.verifiedAt)
    const approvedAt = new Date(activation.approval.approvedAt)
    const verificationAge = approvedAt.getTime() - verifiedAt.getTime()
    if (
      !SHA256.test(activation.shadowParitySha256) ||
      !SHA256.test(activation.isolatedRestoreProofSha256) ||
      !SHA256.test(activation.commandReplayProofSha256) ||
      !withinBackupCeiling(activation.backups.maximumRetentionDays) ||
      !withinBackupCeiling(activation.backups.manualRetentionDays) ||
      !Number.isFinite(verificationAge) ||
      approvedAt > evaluatedAt ||
      verifiedAt.toISOString() !== activation.backups.verifiedAt ||
      verificationAge < 0 ||
      verificationAge > THIRTY_DAYS_MS
    ) {
      throw new ReviewDestructiveLifecycleQuarantinedError()
    }
    return activation.approval
  }
}
