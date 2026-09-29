// "Mark all read" input, kept apart from the server functions so the client
// bundle never carries it (a server-fn module's exports stay in its client
// stub).

import { z } from 'zod/v4'
import { NOTIFICATION_LIST_FILTERS } from '../notification-list-filter'

/**
 * The filter tab the reader is on, and the page's Property filter: "Mark all
 * read" changes only the unread rows they hold. Optional so a tab still
 * running the previous bundle, which sends no body, keeps marking everything
 * as it always did.
 */
export const markAllNotificationsReadDto = z
  .object({
    filter: z.enum(NOTIFICATION_LIST_FILTERS).optional().default('all'),
    propertyId: z.uuid().optional(),
  })
  .optional()

/** "Dismiss all" on the page: the Property filter's rows, or the whole feed. */
export const dismissAllNotificationsDto = z
  .object({ propertyId: z.uuid().optional() })
  .optional()
