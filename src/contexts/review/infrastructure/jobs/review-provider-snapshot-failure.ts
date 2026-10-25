import type { ReviewProviderSnapshotFailureCode } from '../../application/ports/review-provider-snapshot.repository'

/**
 * A provider snapshot step that ended in a coded failure. The code is the
 * message and also a field of its own: error monitoring replaces every message
 * but reads `failureCode` into a tag (shared/observability/error-facts.ts), so
 * the issue says which of the closed set of codes the step failed with.
 */
export class ReviewProviderSnapshotFailure extends Error {
  override readonly name = 'ReviewProviderSnapshotFailure'
  readonly failureCode: ReviewProviderSnapshotFailureCode

  constructor(failureCode: ReviewProviderSnapshotFailureCode) {
    super(failureCode)
    this.failureCode = failureCode
  }
}
