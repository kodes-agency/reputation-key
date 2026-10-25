import { z } from 'zod/v4'
import {
  PRINT_KIT_CALLS_TO_ACTION,
  PRINT_KIT_MAX_LANGUAGES,
  PRINT_KIT_PAPERS,
} from '#/shared/domain/portal-print-kit'
import {
  PRINT_FINAL_LOOKS,
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  PRINT_FINAL_PRINTERS,
} from '#/shared/domain/portal-print-final'
import { PRINT_FINAL_MAX_QUANTITY } from '#/shared/domain/portal-print-final-offer'
import { guestLocaleSchema } from '#/shared/guest-locale-schemas'

/**
 * A final print (final design spec §11): a piece, upright or wide, in a look,
 * for the manager's printer or a print shop, in one or two of the Portal's
 * languages with one call to action. Whether the languages are the Portal's own,
 * and whether the piece prints on its code, is the use case's to say.
 *
 * `paper` is the paper the Property's country prints on unless the request
 * names one. `quantity` is how many pieces the manager needs; `fillSpares`
 * prints the last sheet's spare cells too, and `perSheet` asks for fewer pieces
 * a sheet than fit. A print shop's file is one piece per page, so it ignores the
 * three, though they are still checked. `backPage` adds the optional back page of
 * a card (More options, off by default): its logo and the property's name; a tent
 * has none, since it prints its front on both faces.
 */
export const downloadPortalPrintFinalInputSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
  piece: z.enum(PRINT_FINAL_PIECES),
  orientation: z.enum(PRINT_FINAL_ORIENTATIONS),
  look: z.enum(PRINT_FINAL_LOOKS),
  paper: z.enum(PRINT_KIT_PAPERS).optional(),
  printer: z.enum(PRINT_FINAL_PRINTERS),
  quantity: z
    .number()
    .int('Enter a whole number of pieces')
    .min(1, 'Print one piece at least')
    .max(PRINT_FINAL_MAX_QUANTITY, `Print at most ${PRINT_FINAL_MAX_QUANTITY} at a time`),
  fillSpares: z.boolean().default(false),
  backPage: z.boolean().default(false),
  perSheet: z.number().int().min(1).optional(),
  languages: z
    .array(guestLocaleSchema)
    .min(1, 'Choose a language for the print')
    .max(PRINT_KIT_MAX_LANGUAGES, 'A print carries at most two languages')
    .refine((languages) => new Set(languages).size === languages.length, {
      message: 'Choose two different languages',
    }),
  callToAction: z.enum(PRINT_KIT_CALLS_TO_ACTION),
})

type ParsedInput = z.infer<typeof downloadPortalPrintFinalInputSchema>

/** The parsed input, with the languages read-only; a caller that has not parsed it may leave the spares and the back page out. */
export type DownloadPortalPrintFinalInput = Readonly<
  Omit<ParsedInput, 'languages' | 'fillSpares' | 'backPage'> & {
    languages: readonly ParsedInput['languages'][number][]
    fillSpares?: boolean
    backPage?: boolean
  }
>
