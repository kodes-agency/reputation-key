// Review-side reader of the one fact that proves a reply attempt never left
// RepKey: no `reviews.reply` execution permit exists for it.
//
// The gateway may call `fetch` only for a permit that
// `start_google_execution_permit` has started, and the `property.publish_reply`
// start predicate binds that permit to `authorization_vector->>'replyId'`,
// `'publicationCycle'` and `'publicationAttemptNumber'` of a `sending` attempt
// (src/shared/db/db-constructs.sql, ~2692-2790). A permit in ANY state counts:
// `admitted` may still start, `started`/`completed` did, and `fenced` cannot be
// told apart from one fenced after the request left.
//
// The read below happens outside any lock, so it only nominates an attempt.
// What makes "no permit" final is the settle transaction
// (reply-command-store.ts settleNeverDispatchedAttempt): it locks the attempt
// row and asks `attemptMayHaveDispatched` again. The permit issuer's publication
// check holds FOR SHARE on that same row until its permit commits
// (google-content-authorization-check.ts loadPublicationAttempt), so either the
// settle waits and then sees the permit, or the issuer waits and then finds the
// attempt no longer `sending` and denies. The start predicate alone could not
// close that race: it takes no lock on the attempt or the reply, so a start
// whose snapshot predates the settle commit still starts.
//
// A restore breaks the permit table's memory: an attempt that was `sending` at
// the restore point may have had its permit written after it, and that row is
// gone. Every attempt that started before the latest recovery fence completed
// (`recovery_runs.completed_at`, src/shared/db/recovery/postgres-recovery-fence.ts)
// is therefore never provable.
//
// Identity's permit repository already reads this shared table from its
// infrastructure (google-content-authority.repository.ts); the boundary rules
// allow any context's infrastructure to reach `shared/db`.

import { and, eq, gte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { authorizationExecutionPermits } from '#/shared/db/schema/google-content-control.schema'
import { recoveryRuns } from '#/shared/db/schema/recovery.schema'
import {
  REPLY_DISPATCH_EVIDENCE_WINDOW_MS,
  type ReplyDispatchEvidenceInput,
  type ReplyPublicationDispatchEvidencePort,
} from '../application/ports/reply-publication-dispatch-evidence.port'

const REPLY_ROUTE_KEY = 'reviews.reply'

const isPositiveSafeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 1

const isValidInstant = (value: Date): boolean =>
  value instanceof Date && !Number.isNaN(value.getTime())

/** Input that cannot name one exact attempt can never prove non-dispatch. */
const identifiesOneAttempt = (input: ReplyDispatchEvidenceInput): boolean =>
  isPositiveSafeInteger(input.publicationCycle) &&
  isPositiveSafeInteger(input.attemptNumber) &&
  isValidInstant(input.attemptStartedAt) &&
  isValidInstant(input.now)

export type DispatchedAttemptRef = Pick<
  ReplyDispatchEvidenceInput,
  'organizationId' | 'replyId' | 'publicationCycle' | 'attemptNumber' | 'attemptStartedAt'
>

/**
 * True when a request for this exact attempt could have reached Google: a
 * `reviews.reply` permit names it, or a restore since it started may have lost
 * that permit. Callable on a transaction, so the settle can re-ask it under the
 * attempt row lock.
 */
export async function attemptMayHaveDispatched(
  run: Pick<Database, 'select'>,
  attempt: DispatchedAttemptRef,
): Promise<boolean> {
  const vector = authorizationExecutionPermits.authorizationVector
  // `->>` renders a JSON number as its decimal text, exactly how the start
  // predicate compares these keys against the attempt's integer columns.
  const permits = await run
    .select({ id: authorizationExecutionPermits.id })
    .from(authorizationExecutionPermits)
    .where(
      and(
        eq(authorizationExecutionPermits.organizationId, attempt.organizationId),
        eq(authorizationExecutionPermits.routeKey, REPLY_ROUTE_KEY),
        sql`${vector}->>'replyId' = ${String(attempt.replyId)}`,
        sql`${vector}->>'publicationCycle' = ${String(attempt.publicationCycle)}`,
        sql`${vector}->>'publicationAttemptNumber' = ${String(attempt.attemptNumber)}`,
      ),
    )
    .limit(1)
  if (permits.length > 0) return true

  const restores = await run
    .select({ id: recoveryRuns.id })
    .from(recoveryRuns)
    .where(gte(recoveryRuns.completedAt, attempt.attemptStartedAt))
    .limit(1)
  return restores.length > 0
}

export const createReplyPublicationDispatchEvidence = (
  db: Database,
): ReplyPublicationDispatchEvidencePort => ({
  findDispatchEvidence: async (input) => {
    if (!identifiesOneAttempt(input)) return 'possibly_dispatched'
    if (
      input.now.getTime() - input.attemptStartedAt.getTime() <
      REPLY_DISPATCH_EVIDENCE_WINDOW_MS
    ) {
      return 'too_recent'
    }
    return (await attemptMayHaveDispatched(db, input))
      ? 'possibly_dispatched'
      : 'never_dispatched'
  },
})
