// Portal context — Linktree DTOs: the per-language texts of a link and the
// section's switch and titles. Kept apart from portal-link.dto.ts on purpose:
// the link form imports that module into the browser bundle, and these schemas
// (with the guest-locale catalogue they need) have no business there yet.

import { z } from 'zod/v4'
import { GUEST_LOCALES, type GuestLocale } from '#/shared/domain/guest-locale'
import { offeredGuestLocaleSchema } from '#/shared/guest-locale-schemas'
import {
  LINKTREE_TITLE_MAX_LENGTH,
  LINK_TEXT_LABEL_MAX_LENGTH,
  LINK_TEXT_LINE_MAX_LENGTH,
} from '../../domain/portal-linktree'

// What the editor's forms show: the limits they enforce and the wording a
// language's title has while it is empty. Re-exported so components never reach
// into the domain.
export {
  LINKTREE_TITLE_MAX_LENGTH,
  LINK_TEXT_LABEL_MAX_LENGTH,
  LINK_TEXT_LINE_MAX_LENGTH,
  linktreeDefaultTitle,
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

// What the editor's text form holds while a manager types: one label and line
// per language offered, as strings. The primary language, and any language that
// already has a saved text, must keep a label (there is no way to remove a
// saved text); a language with nothing saved may stay empty and is simply not
// sent. The limits are the server's, so a form can never hold what the save
// would refuse.
export const linkTextsFormSchema = (requiredLocales: readonly GuestLocale[]) =>
  z
    .object({
      texts: z.array(
        z.object({
          locale: offeredGuestLocaleSchema,
          label: z
            .string()
            .trim()
            .max(
              LINK_TEXT_LABEL_MAX_LENGTH,
              `Keep it under ${LINK_TEXT_LABEL_MAX_LENGTH} characters`,
            ),
          line: z
            .string()
            .trim()
            .max(
              LINK_TEXT_LINE_MAX_LENGTH,
              `Keep it under ${LINK_TEXT_LINE_MAX_LENGTH} characters`,
            ),
        }),
      ),
    })
    .superRefine((value, context) => {
      value.texts.forEach((text, index) => {
        if (requiredLocales.includes(text.locale) && text.label === '') {
          context.addIssue({
            code: 'custom',
            path: ['texts', index, 'label'],
            message: 'A link needs a label',
          })
        }
      })
    })

// The section title as typed, one per language; an empty title means the default.
export const linktreeTitlesFormSchema = z.object({
  titles: z.array(
    z.object({
      locale: offeredGuestLocaleSchema,
      title: z
        .string()
        .trim()
        .max(
          LINKTREE_TITLE_MAX_LENGTH,
          `Keep it under ${LINKTREE_TITLE_MAX_LENGTH} characters`,
        ),
    }),
  ),
})
