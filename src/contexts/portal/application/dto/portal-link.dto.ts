// Portal context — link DTOs

import { z } from 'zod/v4'
import { GUEST_LOCALES } from '#/shared/domain/guest-locale'
import { offeredGuestLocaleSchema } from '#/shared/guest-locale-schemas'
import { portalLinkIconKeySchema } from '#/shared/portal-link-icon-schemas'
import { isValidExternalUrl } from '../../domain/rules'
import {
  LINKTREE_TITLE_MAX_LENGTH,
  LINK_TEXT_LABEL_MAX_LENGTH,
  LINK_TEXT_LINE_MAX_LENGTH,
} from '../../domain/portal-linktree'

const portalLinkLabelSchema = z.string().trim().min(1, 'Label is required').max(100)

const portalLinkUrlSchema = z
  .string()
  .trim()
  .min(1, 'URL is required')
  .max(500)
  .refine(isValidExternalUrl, 'Links must start with https://')

export const createLinkInputSchema = z.object({
  categoryId: z.string().min(1, 'Category ID is required'),
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
})

// UpdateLinkInput — exported when consumed by route validators or forms
export const reorderLinksInputSchema = z.object({
  categoryId: z.string().min(1, 'Category ID is required'),
  portalId: z.string().min(1, 'Portal ID is required'),
  items: z.array(
    z.object({
      id: z.string().min(1),
      sortKey: z.string().min(1),
    }),
  ),
})

// ReorderLinksInput — exported when consumed by route validators or forms

// The texts a manager writes for one link, one per language the Portal offers.
// The use case checks the Portal's own language set; this only bounds the shape.
export const savePortalLinkTextsInputSchema = z.object({
  linkId: z.string().min(1, 'Link ID is required'),
  texts: z
    .array(
      z.object({
        locale: offeredGuestLocaleSchema,
        label: z.string().max(LINK_TEXT_LABEL_MAX_LENGTH * 2),
        line: z
          .string()
          .max(LINK_TEXT_LINE_MAX_LENGTH * 2)
          .nullable()
          .optional(),
      }),
    )
    .min(1)
    .max(GUEST_LOCALES.length),
})

// The link section's switch and its title per language; null resets to the default.
export const saveLinktreeSettingsInputSchema = z
  .object({
    portalId: z.string().min(1, 'Portal ID is required'),
    enabled: z.boolean().optional(),
    titles: z
      .array(
        z.object({
          locale: offeredGuestLocaleSchema,
          title: z
            .string()
            .max(LINKTREE_TITLE_MAX_LENGTH * 2)
            .nullable(),
        }),
      )
      .max(GUEST_LOCALES.length)
      .optional(),
  })
  .refine(
    (input) => input.enabled !== undefined || (input.titles?.length ?? 0) > 0,
    'Give the switch or a title to save',
  )
