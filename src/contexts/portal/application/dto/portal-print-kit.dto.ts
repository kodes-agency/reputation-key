import { z } from 'zod/v4'
import {
  PRINT_KIT_CALLS_TO_ACTION,
  PRINT_KIT_MAX_LANGUAGES,
  PRINT_KIT_PAPERS,
  PRINT_KIT_PIECES,
  PRINT_KIT_STYLES,
} from '#/shared/domain/portal-print-kit'
import { guestLocaleSchema } from '#/shared/guest-locale-schemas'

const portalIdSchema = z.string().min(1, 'Portal ID is required')

/** The print kit read: which Portal's look and languages to show. */
export const portalPrintKitInputSchema = z.object({ portalId: portalIdSchema })

/**
 * One piece, in one or two of the Portal's languages, with one call to action.
 * Whether the languages are the Portal's own is the use case's to say: it knows
 * the Portal, the schema only knows the catalogue.
 *
 * `style` asks for the redesigned print, on `paper` or, without one, on the
 * paper the Property's country prints on; for Immersive the paper names the
 * size family, 4 × 6 in on Letter and A6 on A4. A download without a style is
 * today's print, and its `paper` is not read.
 */
export const downloadPortalPrintKitInputSchema = z.object({
  portalId: portalIdSchema,
  piece: z.enum(PRINT_KIT_PIECES),
  languages: z
    .array(guestLocaleSchema)
    .min(1, 'Choose a language for the print')
    .max(PRINT_KIT_MAX_LANGUAGES, 'A print carries at most two languages')
    .refine((languages) => new Set(languages).size === languages.length, {
      message: 'Choose two different languages',
    }),
  callToAction: z.enum(PRINT_KIT_CALLS_TO_ACTION),
  style: z.enum(PRINT_KIT_STYLES).optional(),
  paper: z.enum(PRINT_KIT_PAPERS).optional(),
})

type ParsedDownloadInput = z.infer<typeof downloadPortalPrintKitInputSchema>

/** The parsed input, with the languages read-only: nothing downstream edits them. */
export type DownloadPortalPrintKitInput = Readonly<
  Omit<ParsedDownloadInput, 'languages'> & {
    languages: readonly ParsedDownloadInput['languages'][number][]
  }
>
