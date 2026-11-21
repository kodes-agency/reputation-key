/** Local implementation tests cannot authorize production erasure. */
export const REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE = Object.freeze({
  owner: 'review-context',
  reason: 'external Review lifecycle shadow parity and cutover are not approved',
  releaseCondition:
    'external zero-difference shadow window, passing isolated restore and command-level erasure replay proof, verified backups within 30 days including the Manual backup, and explicit owner approval of the first apply',
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

/**
 * Runtime schedule authority. This is intentionally not configuration: an
 * environment variable cannot bypass the migration and evidence gate.
 */
export function isLegacyDestructiveReviewLifecycleEnabled(): false {
  return false
}
