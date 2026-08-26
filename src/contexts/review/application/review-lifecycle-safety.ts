/**
 * SAFE-03 containment for the legacy Review lifecycle.
 *
 * The current Review row still owns provider-controlled fields while Replies
 * reference it with `ON DELETE CASCADE`. Until REV-01 separates stable
 * RepKey-owned identity/history from expiring provider content, deleting that
 * row is never a safe lifecycle operation.
 */
export const REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE = Object.freeze({
  owner: 'review-context',
  reason: 'stable Review identity and Reply history are not storage-separated',
  releaseCondition:
    'REV-01 migration plus real-PostgreSQL expiry, provider-delete, and re-observation proof',
  releaseDecision: 'explicit-reviewed-cutover',
} as const)

export class ReviewDestructiveLifecycleQuarantinedError extends Error {
  readonly _tag = 'ReviewDestructiveLifecycleQuarantinedError' as const
  readonly code = 'review_destructive_lifecycle_quarantined' as const

  constructor() {
    super(
      `Review destructive lifecycle is quarantined: ${REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE.reason}`,
    )
    this.name = 'ReviewDestructiveLifecycleQuarantinedError'
  }
}

export function denyLegacyReviewDestruction(): never {
  throw new ReviewDestructiveLifecycleQuarantinedError()
}

/**
 * Runtime schedule authority. This is intentionally not configuration: an
 * environment variable cannot bypass the migration and evidence gate.
 */
export function isLegacyDestructiveReviewLifecycleEnabled(): false {
  return false
}
