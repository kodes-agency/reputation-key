// "Mark all read" input, kept apart from the server functions so the client
// bundle never carries it (a server-fn module's exports stay in its client
// stub).

import { z } from 'zod/v4'
import { NOTIFICATION_LIST_FILTERS } from '../notification-list-filter'

/**
 * The filter tab the reader is on: "Mark all read" changes only the unread
 * rows it holds. Optional so a tab still running the previous bundle, which
 * sends no body, keeps marking everything as it always did.
 */
export const markAllNotificationsReadDto = z
  .object({ filter: z.enum(NOTIFICATION_LIST_FILTERS).optional().default('all') })
  .optional()
