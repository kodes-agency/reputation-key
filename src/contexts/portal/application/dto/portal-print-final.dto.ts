import { z } from 'zod/v4'
import {
  PRINT_KIT_MAX_LANGUAGES,
  PRINT_KIT_PAPERS,
} from '#/shared/domain/portal-print-kit'
import { PRINT_FINAL_CALLS_TO_ACTION } from '#/shared/domain/portal-print-final-copy'
import {
  PRINT_FINAL_CUSTOM_MAX_CHARACTERS,
  normalisePrintFinalText,
  hasPrintFinalControlCharacters,
} from '#/shared/domain/portal-print-final-custom'
import {
  PRINT_FINAL_LOOKS,
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  PRINT_FINAL_PRINTERS,
} from '#/shared/domain/portal-print-final'
import { PRINT_FINAL_MAX_QUANTITY } from '#/shared/domain/portal-print-final-offer'
import { guestLocaleSchema } from '#/shared/guest-locale-schemas'

const MAX_FIELD = `Keep each line to ${PRINT_FINAL_CUSTOM_MAX_CHARACTERS} characters`

/** One field of the manager's own words: one line, normalised as Share normalises it. */
const customFieldSchema = z
  .string()
  // A pasted paragraph is bounded before it is read; the normalised words are bounded below.
  .max(PRINT_FINAL_CUSTOM_MAX_CHARACTERS * 4, MAX_FIELD)
  .refine((text) => !hasPrintFinalControlCharacters(text), {
    message: 'Use letters, numbers and punctuation only',
  })
  .transform(normalisePrintFinalText)
  .refine((text) => [...text].length <= PRINT_FINAL_CUSTOM_MAX_CHARACTERS, {
    message: MAX_FIELD,
  })

/** One language's own words (§5.6): a headline, and a sub-line that may be empty. */
const customCopySchema = z.object({
  headline: customFieldSchema.refine((text) => text !== '', {
    message: 'Write a headline, or pick a wording',
  }),
  subline: customFieldSchema,
})

/** The own words of a print or of a saved wording: guest languages only, each a headline and a sub-line. */
export const printFinalCustomWordsSchema = z.partialRecord(
  guestLocaleSchema,
  customCopySchema,
)

/**
 * A final print (final design spec §11): a piece, upright or wide, in a look,
 * for the manager's printer or a print shop, in one or two of the Portal's
 * languages with one call to action: a wording of Share's menu, and the
 * manager's own words for each language where they wrote them (`customWords`,
 * only languages of the print, each a headline and a sub-line, trimmed, on one
 * line, at most 60 characters; the wording stays as where they started). Whether the languages are the Portal's own,
 * and whether the piece prints on its code, is the use case's to say.
 *
 * `paper` is the paper the Property's country prints on unless the request
 * names one. `quantity` is how many pieces the manager needs; `fillSpares`
 * prints the last sheet's spare cells too, and `perSheet` asks for fewer pieces
 * a sheet than fit. A print shop's file is one piece per page, so it ignores the
 * three, though they are still checked. `cropMarks` is the print shop's own
 * option (More options, off by default): the page grows to carry crop marks along
 * the trim; from the manager's printer it is ignored. `backPage` adds the optional
 * back page of a card (More options, off by default): its logo and the property's
 * name; a tent has none, since it prints its front on both faces.
 */
export const downloadPortalPrintFinalInputSchema = z
  .object({
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
      .max(
        PRINT_FINAL_MAX_QUANTITY,
        `Print at most ${PRINT_FINAL_MAX_QUANTITY} at a time`,
      ),
    fillSpares: z.boolean().default(false),
    cropMarks: z.boolean().default(false),
    backPage: z.boolean().default(false),
    perSheet: z.number().int().min(1).optional(),
    languages: z
      .array(guestLocaleSchema)
      .min(1, 'Choose a language for the print')
      .max(PRINT_KIT_MAX_LANGUAGES, 'A print carries at most two languages')
      .refine((languages) => new Set(languages).size === languages.length, {
        message: 'Choose two different languages',
      }),
    callToAction: z.enum(PRINT_FINAL_CALLS_TO_ACTION),
    customWords: printFinalCustomWordsSchema.nullish(),
  })
  .refine(
    (input) =>
      input.customWords == null ||
      Object.keys(input.customWords).every((locale) =>
        (input.languages as readonly string[]).includes(locale),
      ),
    {
      message: 'Write your own words only in the languages you print',
      path: ['customWords'],
    },
  )

type ParsedInput = z.infer<typeof downloadPortalPrintFinalInputSchema>

/** The parsed input, with the languages read-only; a caller that has not parsed it may leave the spares, the crop marks and the back page out. */
export type DownloadPortalPrintFinalInput = Readonly<
  Omit<ParsedInput, 'languages' | 'fillSpares' | 'cropMarks' | 'backPage'> & {
    languages: readonly ParsedInput['languages'][number][]
    fillSpares?: boolean
    cropMarks?: boolean
    backPage?: boolean
  }
>
