import { z } from 'zod/v4'
import {
  PRINT_KIT_CALLS_TO_ACTION,
  PRINT_KIT_MAX_LANGUAGES,
  PRINT_KIT_PIECES,
} from '#/shared/domain/portal-print-kit'
import { guestLocaleSchema } from '#/shared/guest-locale-schemas'

const portalIdSchema = z.string().min(1, 'Portal ID is required')

/** The print kit read: which Portal's look and languages to show. */
export const portalPrintKitInputSchema = z.object({ portalId: portalIdSchema })

/**
 * One piece, in one or two of the Portal's languages, with one call to action.
 * Whether the languages are the Portal's own is the use case's to say: it knows
 * the Portal, the schema only knows the catalogue.
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
})

type ParsedDownloadInput = z.infer<typeof downloadPortalPrintKitInputSchema>

/** The parsed input, with the languages read-only: nothing downstream edits them. */
export type DownloadPortalPrintKitInput = Readonly<
  Omit<ParsedDownloadInput, 'languages'> & {
    languages: readonly ParsedDownloadInput['languages'][number][]
  }
>
