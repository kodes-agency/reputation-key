import { z } from 'zod/v4'
import {
  PRINT_KIT_CALLS_TO_ACTION,
  PRINT_KIT_MAX_LANGUAGES,
  PRINT_KIT_OUTPUTS,
  PRINT_KIT_PAPERS,
  PRINT_KIT_PIECES,
  PRINT_KIT_SIZES,
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
 * `style` is Paper unless the request says Immersive, and `paper` is the paper
 * the Property's country prints on unless the request names one; for Immersive
 * the paper names the size family, 4 × 6 in on Letter and A6 on A4.
 *
 * `size` is Large unless the request names another (round 3); the use case
 * refuses a size managers may not choose yet. `output` is the style's own
 * unless named: a print shop for Immersive, the office printer for Paper.
 *
 * `showPropertyName` is on unless the request turns it off: a logo on a Large or
 * Table card carries the property's name under it (round-2 R6). The tent and
 * Mini never print it.
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
  style: z.enum(PRINT_KIT_STYLES).default('paper'),
  paper: z.enum(PRINT_KIT_PAPERS).optional(),
  size: z.enum(PRINT_KIT_SIZES).default('large'),
  output: z.enum(PRINT_KIT_OUTPUTS).optional(),
  showPropertyName: z.boolean().default(true),
})

type ParsedDownloadInput = z.infer<typeof downloadPortalPrintKitInputSchema>

/**
 * The parsed input, with the languages read-only: nothing downstream edits them.
 * The size and the name line may be left out by a caller that has not parsed
 * them (a test, a script): Large and on, as the schema's defaults make them.
 */
export type DownloadPortalPrintKitInput = Readonly<
  Omit<ParsedDownloadInput, 'languages' | 'size' | 'showPropertyName'> & {
    languages: readonly ParsedDownloadInput['languages'][number][]
    size?: ParsedDownloadInput['size']
    showPropertyName?: boolean
  }
>
