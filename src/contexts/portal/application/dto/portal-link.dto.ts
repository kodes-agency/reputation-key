// Portal context — link DTOs

import { z } from 'zod/v4'
import { portalLinkIconKeySchema } from '#/shared/portal-link-icon-schemas'
import { isValidExternalUrl } from '../../domain/rules'

const portalLinkLabelSchema = z.string().trim().min(1, 'Label is required').max(100)

const portalLinkUrlSchema = z
  .string()
  .trim()
  .min(1, 'URL is required')
  .max(500)
  .refine(isValidExternalUrl, 'Links must start with https://')

export const createLinkInputSchema = z.object({
  // Left out by the Linktree editor, which does not show categories: the link
  // then joins the Portal's last category.
  categoryId: z.string().min(1, 'Category ID is required').optional(),
  portalId: z.string().min(1, 'Portal ID is required'),
  label: portalLinkLabelSchema,
  url: portalLinkUrlSchema,
  iconKey: portalLinkIconKeySchema.optional(),
})

// CreateLinkInput — exported when consumed by route validators or forms
export const updateLinkInputSchema = z.object({
  linkId: z.string().min(1, 'Link ID is required'),
  label: portalLinkLabelSchema.optional(),
  url: portalLinkUrlSchema.optional(),
  iconKey: portalLinkIconKeySchema.nullable().optional(),
  // A picture uploaded for this tile (POST /api/portal-media, purpose link_image),
  // or null to take it off. Left out, the picture stays as it is.
  imageAssetId: z.uuid().nullable().optional(),
})

/**
 * The most links one reorder may name. The server function looks each one up
 * once the policy has admitted the caller, and the command writes one row per
 * link, so the list is bounded where the request is read. A new Portal carries
 * at most four links and an older one keeps what it had; this is far above
 * either.
 */
export const MAX_REORDER_LINKS = 100

/** `portal_links.sort_key` is `varchar(50)`. */
const MAX_SORT_KEY_LENGTH = 50

// UpdateLinkInput — exported when consumed by route validators or forms
export const reorderLinksInputSchema = z.object({
  categoryId: z.string().min(1, 'Category ID is required'),
  portalId: z.string().min(1, 'Portal ID is required'),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        sortKey: z.string().min(1).max(MAX_SORT_KEY_LENGTH),
      }),
    )
    .max(MAX_REORDER_LINKS),
})

// ReorderLinksInput — exported when consumed by route validators or forms
