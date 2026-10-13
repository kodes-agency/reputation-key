// Inbox search schema. `queue` is the public workspace vocabulary; the input
// still accepts `folder` long enough to preserve old bookmarks (ADR 0057).
import { z } from 'zod/v4'
// From the queues' own module, not the context's public-api barrel: this schema
// is route config, so it is in first paint, and the barrel brought the Inbox
// command DTO and its zod schemas with it (scripts/check-bundle-budget.mjs,
// 2026-10-11).
import { INBOX_QUEUES } from '#/contexts/inbox/application/inbox-queues'
import { ASPECT_POLARITIES_V1, ASPECT_TAXONOMY_V1 } from '#/shared/aspect-taxonomy'

export const INBOX_PAGE_SIZE = 50

/**
 * One key of the address. A value the page cannot read (an old vocabulary, a
 * hand-edited URL, a number where the router found only digits) is dropped and
 * the rest of the address is kept, as the Properties and Portals lists do:
 * refusing the page left the generic error and a "Try again" that read the
 * same address again.
 */
const readable = <Schema extends z.ZodType>(schema: Schema) =>
  schema.optional().catch(undefined)

export const inboxSearchObjectSchema = z.object({
  queue: readable(z.enum(INBOX_QUEUES)),
  folder: readable(z.enum(['open', 'escalated', 'closed'])),
  itemId: readable(z.uuid()),
  // An id or nothing: any other text used to pass as a property scope.
  propertyId: readable(z.uuid()),
  sourceType: readable(z.enum(['review', 'feedback'])),
  ratingMin: readable(z.coerce.number().int().min(1).max(5)),
  ratingMax: readable(z.coerce.number().int().min(1).max(5)),
  attention: readable(z.enum(['urgent', 'high', 'medium', 'low'])),
  // Aspect and polarity remain separate URL keys so dashboard drill-downs are
  // readable (`?aspect=wait_time&polarity=negative`) and either dimension can
  // be widened without inventing a second composite vocabulary.
  aspect: readable(z.enum(ASPECT_TAXONOMY_V1)),
  polarity: readable(z.enum(ASPECT_POLARITIES_V1)),
  q: readable(z.string()),
  sort: readable(z.enum(['newest', 'oldest'])),
})

type InboxSearchObject = z.infer<typeof inboxSearchObjectSchema>

/** Keep route state aligned with the three rating presets the UI can render. */
export function normalizeInboxRatingPreset(search: InboxSearchObject): InboxSearchObject {
  const { ratingMin, ratingMax, ...rest } = search
  if (ratingMin === undefined && ratingMax === undefined) return search
  if (ratingMin === 5 && (ratingMax === undefined || ratingMax === 5)) {
    return { ...rest, ratingMin: 5, ratingMax: 5 }
  }
  if (ratingMin === 4 && (ratingMax === undefined || ratingMax === 5)) {
    return { ...rest, ratingMin: 4 }
  }
  if (ratingMax === 3 && (ratingMin === undefined || ratingMin === 1)) {
    return { ...rest, ratingMax: 3 }
  }
  return rest
}

const LEGACY_FOLDER_QUEUE = {
  open: 'reply',
  escalated: 'escalated',
  closed: 'closed',
} as const

export const inboxSearchSchema = inboxSearchObjectSchema.transform((input) => {
  const { folder, ...search } = normalizeInboxRatingPreset(input)
  const queue = search.queue ?? (folder ? LEGACY_FOLDER_QUEUE[folder] : undefined)
  return queue ? { ...search, queue } : search
})

export type InboxSearchParams = z.infer<typeof inboxSearchSchema>
