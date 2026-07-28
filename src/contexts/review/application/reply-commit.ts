// Review context — BQC-3.3 reply commit sequence (single source, BQC-5.9 E5).
//
// Every fact-emitting reply transition runs the same sequence: the domain
// transition check (transitionReply is the authority) → the atomic guarded
// command-store commit → invalid_transition when the guard matches no row
// (a lost TOCTOU race). The mutation use cases throw the error; the
// reconcile path returns it — the Result return lets each caller keep its
// own error channel while the error VALUES stay identical.

import type { Result } from '#/shared/domain'
import { ok, err } from '#/shared/domain'
import type { Reply, ReplyStatus } from '../domain/types'
import type { ReviewError } from '../domain/errors'
import { reviewError } from '../domain/errors'
import { transitionReply } from '../domain/rules'

/**
 * Run the BQC-3.3 commit sequence for a reply transition: validate the
 * transition, then run the guarded command-store commit. A null store
 * result (lost TOCTOU race) becomes the shared invalid_transition error.
 */
export async function commitTransition(
  reply: Reply,
  target: ReplyStatus,
  now: Date,
  commit: () => Promise<Reply | null>,
): Promise<Result<Reply, ReviewError>> {
  const transitioned = transitionReply(reply, target, now)
  if (transitioned.isErr()) return err(transitioned.error)
  const updated = await commit()
  if (!updated) {
    return err(reviewError('invalid_transition', 'Reply status changed concurrently'))
  }
  return ok(updated)
}
