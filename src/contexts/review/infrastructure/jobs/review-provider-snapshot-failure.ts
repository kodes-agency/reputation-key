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

/**
 * The failure of a step that continues a run and failed it. The store fails the
 * run before the step throws, so a retry of the step could only find the run
 * failed: the attempt that failed it is the only one that can fail the job, and
 * it does so for good.
 *
 * It is named `UnrecoverableError` on purpose. BullMQ stops retrying a job whose
 * error carries that name, and the worker reads the same name to decide that a
 * failure is terminal on its first attempt, which is what captures it in error
 * monitoring, dead-letters the job and latches the family's repair state
 * (shared/jobs/failure-quarantine.ts). The failure code travels as in
 * `ReviewProviderSnapshotFailure`: the message, and a field the error facts read
 * into a tag.
 */
export class ReviewProviderSnapshotRunFailure extends Error {
  override readonly name = 'UnrecoverableError'
  readonly failureCode: ReviewProviderSnapshotFailureCode

  constructor(failureCode: ReviewProviderSnapshotFailureCode) {
    super(failureCode)
    this.failureCode = failureCode
  }
}
