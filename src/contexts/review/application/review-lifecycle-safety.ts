/**
 * SAFE-03 containment for the legacy Review lifecycle.
 *
 * The expand schema and repository now separate erasable provider content
 * while preserving stable Review/Reply identity. Recurring apply still stays
 * unavailable until production shadow parity and the reviewed cutover are
 * recorded; local implementation proof cannot grant that authority.
 */
export const REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE = Object.freeze({
  owner: 'review-context',
  reason: 'external Review lifecycle shadow parity and cutover are not approved',
  releaseCondition:
    'REV-01 external zero-difference shadow window, restore evidence, and explicit activation approval',
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
