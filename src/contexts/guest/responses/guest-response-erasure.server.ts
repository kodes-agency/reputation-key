// What an erased Guest response looks like, shared by the live withdrawal and
// the restore replay so both converge to the same stored state.

import { and, eq, inArray } from 'drizzle-orm'
import {
  guestContactRequests,
  guestResponsePrivateFeedback,
} from '#/shared/db/schema/guest.schema'
import type { Tx } from '#/shared/outbox/commit'

export const erasedResponseColumns = (
  deletedAt: Date | null | undefined,
  updatedAt: Date,
) => ({
  status: 'deleted' as const,
  rating: null,
  categoryId: null,
  responseConsent: false,
  textConsent: false,
  mediaConsent: false,
  ratingSourceEventId: null,
  feedbackSourceEventId: null,
  deletedAt,
  updatedAt,
})

/**
 * Delete the private feedback and the contact of the named responses (the
 * reveal audits go with the contact through their foreign key). Returns the
 * number of rows removed.
 */
export async function deleteResponseSatellites(
  tx: Tx,
  organization: string,
  responseIds: ReadonlyArray<string>,
): Promise<number> {
  const feedback = await tx
    .delete(guestResponsePrivateFeedback)
    .where(
      and(
        eq(guestResponsePrivateFeedback.organizationId, organization),
        inArray(guestResponsePrivateFeedback.responseId, [...responseIds]),
      ),
    )
    .returning({ id: guestResponsePrivateFeedback.responseId })
  const contact = await tx
    .delete(guestContactRequests)
    .where(
      and(
        eq(guestContactRequests.organizationId, organization),
        inArray(guestContactRequests.responseId, [...responseIds]),
      ),
    )
    .returning({ id: guestContactRequests.id })
  return feedback.length + contact.length
}
