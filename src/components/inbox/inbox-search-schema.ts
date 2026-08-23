// Inbox search schema — extracted from inbox-page-v2 for reuse.
// Per ADR 0023: 3 folders (Open, Escalated, Closed). The Escalated folder
// filters by the active escalation flag, not a status value.
import { z } from 'zod/v4'
import type { InboxStatus } from '#/contexts/inbox/application/public-api'
import { AI_PRIMARY_CATEGORIES } from '#/shared/openai-route-output-schemas'

export const INBOX_PAGE_SIZE = 50

export type InboxFolder = 'open' | 'escalated' | 'closed'

export const inboxSearchObjectSchema = z.object({
  folder: z.enum(['open', 'escalated', 'closed']).optional(),
  itemId: z.string().uuid().optional(),
  propertyId: z.string().optional(),
  sourceType: z.enum(['review', 'feedback']).optional(),
  platform: z.string().optional(),
  ratingMin: z.coerce.number().int().min(1).max(5).optional(),
  ratingMax: z.coerce.number().int().min(1).max(5).optional(),
  attention: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  // Enum over the canonical AI category catalogue — the same list the provider
  // output schema is built from, so a deep link like `?category=wait_time`
  // cannot drift from what the analysis actually stores.
  category: z.enum(AI_PRIMARY_CATEGORIES).optional(),
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

export const inboxSearchSchema = inboxSearchObjectSchema.transform(
  normalizeInboxRatingPreset,
)

export type InboxSearchParams = z.infer<typeof inboxSearchSchema>

/** Map folder slug to status filter. The Escalated folder is NOT a status —
 *  it filters by the active escalation flag (see folderIsEscalated). The default
 *  folder (undefined — the sidebar navigates with `key || undefined`, so the
 *  empty-string key becomes undefined in the route) is the Open working view. */
export function folderToStatus(folder: string | undefined): InboxStatus | undefined {
  if (!folder || folder === 'open') return 'open'
  if (folder === 'closed') return 'closed'
  return undefined
}
export function folderIsEscalated(folder: string | undefined): boolean {
  return folder === 'escalated'
}
