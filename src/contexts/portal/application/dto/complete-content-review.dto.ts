// Portal context — content review DTO
//
// `reviewId` is the idempotency key the browser makes for one review act
// (`crypto.randomUUID()`). It becomes the `source_aggregate_id` and a payload
// field of the three facts a review records, and a superseded id is the event
// id of one of those facts. Both are held to a UUID here, where the request is
// read, so no fact carries text of a caller's choosing and size.

import { z } from 'zod/v4'

export const completeContentReviewInputSchema = z.object({
  portalId: z.string().min(1),
  reviewId: z.uuid(),
  revision: z.number().int().min(1),
  supersedes: z
    .object({
      contentReviewSourceEventId: z.uuid(),
      configurationSourceEventId: z.uuid(),
      destinationRatioSourceEventId: z.uuid(),
    })
    .nullable()
    .optional(),
})
