import { z } from 'zod/v4'
import { PORTAL_PREVIEW_SOURCES } from '../portal-preview'

/** What the preview read takes: which Portal, and the draft or the live version. */
export const portalPreviewInputSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
  source: z.enum(PORTAL_PREVIEW_SOURCES),
})

export type PortalPreviewInput = z.infer<typeof portalPreviewInputSchema>
