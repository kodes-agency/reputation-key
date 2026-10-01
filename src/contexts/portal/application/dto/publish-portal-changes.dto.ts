// Portal context — publish changes while live DTOs

import { z } from 'zod/v4'

/** A Property-look publish names every live Portal it reaches; this bounds one request. */
export const MAX_PORTALS_PER_PUBLISH_BATCH = 50

export const publishPortalChangesInputSchema = z
  .object({ portalId: z.string().min(1, 'Portal ID is required') })
  .strict()

export const publishPortalsChangesInputSchema = z
  .object({
    portalIds: z
      .array(z.string().min(1, 'Portal ID is required'))
      .min(1)
      .max(MAX_PORTALS_PER_PUBLISH_BATCH),
  })
  .strict()
