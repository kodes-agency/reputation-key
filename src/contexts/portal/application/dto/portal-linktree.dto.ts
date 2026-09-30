// Portal context — Linktree DTOs: the per-language texts of a link and the
// section's switch and titles. Kept apart from portal-link.dto.ts on purpose:
// the link form imports that module into the browser bundle, and these schemas
// (with the guest-locale catalogue they need) have no business there yet.

import { z } from 'zod/v4'
import { GUEST_LOCALES } from '#/shared/domain/guest-locale'
import { offeredGuestLocaleSchema } from '#/shared/guest-locale-schemas'
import {
  LINKTREE_TITLE_MAX_LENGTH,
  LINK_TEXT_LABEL_MAX_LENGTH,
  LINK_TEXT_LINE_MAX_LENGTH,
} from '../../domain/portal-linktree'

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
