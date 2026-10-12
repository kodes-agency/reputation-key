// The reply publication cancellation fact's schema, registered by
// ./schema-registrations.ts.
//
// BQC-3.8: identifier-only (reply/review/property/org + cause). No reply text,
// no actor content. `authorId` is the one person who was told the reply was
// queued to publish, so the notice can reach them; optional because rows
// recorded before it existed carry no author.
//
// The cause is a closed vocabulary that Review's event type
// (`ReviewReplyPublicationCancelled`) and Feed's notice copy share. Review
// records the first four when it stops a cycle. `ai_draft_withdrawn` is
// recorded by the AI draft purge (src/shared/db/ai/ai-draft-purge.ts), which
// runs inside other contexts' transactions: this schema is what checks the
// fact it builds.

import { z } from 'zod/v4'

/** A PostgreSQL uuid as the outbox carries it; shared with ./schema-registrations.ts. */
export const databaseUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu)

export const replyPublicationCancelledSchema = z.object({
  replyId: databaseUuidSchema,
  reviewId: databaseUuidSchema,
  organizationId: z.string().trim().min(1),
  propertyId: databaseUuidSchema,
  authorId: z.string().nullable().optional(),
  cause: z.enum([
    'disconnect',
    'policy',
    'source_changed',
    'provider_truth',
    'ai_draft_withdrawn',
  ]),
  occurredAt: z.iso.datetime(),
})
