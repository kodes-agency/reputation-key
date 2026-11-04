// Review context — the content clock of the Google reply a read restates.
//
// A read that finds the reply the head already holds records no row (see
// `restatesCurrentHead` in the store), but it is a successful Google fetch of
// that reply, and a reply's 30-day content clock counts from the last such
// fetch (ADR 0031), as a Review's does. The Inbox refuses a reply whose clock
// has passed (`isContentEligibleForRead`), so the clock has to follow the
// reads: a reply Google still shows would otherwise stop being served 30 days
// after it was first stored.

import { and, eq, lt } from 'drizzle-orm'
import {
  googleReplyObservationHeads,
  googleReplyObservations,
} from '#/shared/db/schema/review.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { RecordGoogleReplyObservation } from '../application/ports/google-reply-observation-store.port'

type ObservationRow = typeof googleReplyObservations.$inferSelect

type RestatingRead = Pick<
  RecordGoogleReplyObservation,
  'organizationId' | 'reviewId' | 'observedAt' | 'contentExpiresAt'
>

/** The observation the current head points at, in full. */
async function selectHeadObservation(
  tx: Tx,
  read: RestatingRead,
): Promise<ObservationRow | undefined> {
  const rows = await tx
    .select({ observation: googleReplyObservations })
    .from(googleReplyObservationHeads)
    .innerJoin(
      googleReplyObservations,
      eq(googleReplyObservations.id, googleReplyObservationHeads.observationId),
    )
    .where(
      and(
        eq(googleReplyObservationHeads.organizationId, read.organizationId),
        eq(googleReplyObservationHeads.reviewId, read.reviewId),
      ),
    )
    .limit(1)
  return rows[0]?.observation
}

/**
 * The observation the head points at, its content clock moved to this read's
 * expiry. Only the head's row moves, and only forward: a read whose expiry is
 * not later changes nothing, `updated_at` included. A row that no longer holds
 * a reply, erased or recording none, keeps the clock it has. A row already past
 * its clock is renewed like any other, because the read shows Google still has
 * the reply. `observed_at` stays the first time the reply was seen and
 * `updated_at` becomes the latest fetch that returned it. No row, revision,
 * fact or provider time is written. Returns the row as it now stands.
 */
export async function renewHeadContentClock(
  tx: Tx,
  read: RestatingRead,
): Promise<ObservationRow | undefined> {
  const current = await selectHeadObservation(tx, read)
  if (!current) return undefined
  const renewed = await tx
    .update(googleReplyObservations)
    .set({ contentExpiresAt: read.contentExpiresAt, updatedAt: read.observedAt })
    .where(
      and(
        eq(googleReplyObservations.id, current.id),
        eq(googleReplyObservations.organizationId, read.organizationId),
        eq(googleReplyObservations.state, 'live'),
        eq(googleReplyObservations.contentState, 'active'),
        lt(googleReplyObservations.contentExpiresAt, read.contentExpiresAt),
      ),
    )
    .returning()
  return renewed[0] ?? current
}
