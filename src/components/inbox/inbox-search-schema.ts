// Inbox search schema. `queue` is the public workspace vocabulary; the input
// still accepts `folder` long enough to preserve old bookmarks (ADR 0057).
import { z } from 'zod/v4'
import { INBOX_QUEUES } from '#/contexts/inbox/application/public-api'
import { ASPECT_POLARITIES_V1, ASPECT_TAXONOMY_V1 } from '#/shared/aspect-taxonomy'

export const INBOX_PAGE_SIZE = 50

export const inboxSearchObjectSchema = z.object({
  queue: z.enum(INBOX_QUEUES).optional(),
  folder: z.enum(['open', 'escalated', 'closed']).optional(),
  itemId: z.uuid().optional(),
  propertyId: z.string().optional(),
  sourceType: z.enum(['review', 'feedback']).optional(),
  ratingMin: z.coerce.number().int().min(1).max(5).optional(),
  ratingMax: z.coerce.number().int().min(1).max(5).optional(),
  attention: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  // Aspect and polarity remain separate URL keys so dashboard drill-downs are
  // readable (`?aspect=wait_time&polarity=negative`) and either dimension can
  // be widened without inventing a second composite vocabulary.
  aspect: z.enum(ASPECT_TAXONOMY_V1).optional(),
  polarity: z.enum(ASPECT_POLARITIES_V1).optional(),
  q: z.string().optional(),
  sort: z.enum(['newest', 'oldest']).optional(),
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
