// Inbox search schema — extracted from inbox-page-v2 for reuse.
// Per ADR 0023: 3 folders (Open, Escalated, Closed). The Escalated folder
// filters by the active escalation flag, not a status value.
import { z } from 'zod/v4'
import type { InboxStatus } from '#/contexts/inbox/application/public-api'

export const INBOX_PAGE_SIZE = 50

export type InboxFolder = 'open' | 'escalated' | 'closed'

export const inboxSearchSchema = z.object({
  folder: z.enum(['open', 'escalated', 'closed']).optional(),
  itemId: z.string().uuid().optional(),
  propertyId: z.string().optional(),
  sourceType: z.enum(['review', 'feedback']).optional(),
  platform: z.string().optional(),
  ratingMin: z.coerce.number().int().min(1).max(5).optional(),
  ratingMax: z.coerce.number().int().min(1).max(5).optional(),
  q: z.string().optional(),
})

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
