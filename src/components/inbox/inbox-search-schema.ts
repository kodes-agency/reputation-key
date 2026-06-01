// Inbox search schema — extracted from inbox-page-v2 for reuse.
import { z } from 'zod/v4'

export const INBOX_PAGE_SIZE = 50

export const inboxSearchSchema = z.object({
  folder: z.enum(['escalated', 'addressed', 'archived']).optional(),
  tab: z.enum(['all', 'unaddressed']).optional(),
  itemId: z.string().uuid().optional(),
  propertyId: z.string().optional(),
  sourceType: z.enum(['review', 'feedback']).optional(),
  platform: z.string().optional(),
  ratingMin: z.coerce.number().int().min(1).max(5).optional(),
  ratingMax: z.coerce.number().int().min(1).max(5).optional(),
  q: z.string().optional(),
})

export type InboxSearchParams = z.infer<typeof inboxSearchSchema>

// Map folder slug to status filter value (null = no status filter = "Inbox" = all)
export function folderToStatus(
  folder: string | undefined,
): 'addressed' | 'escalated' | 'archived' | undefined {
  switch (folder) {
    case 'escalated':
      return 'escalated'
    case 'addressed':
      return 'addressed'
    case 'archived':
      return 'archived'
    default:
      return undefined
  }
}
