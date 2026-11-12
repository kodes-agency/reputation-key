import { z } from 'zod/v4'
import { PRINT_CALLS_TO_ACTION } from '#/shared/domain/portal-print-copy'
import { printCustomWordsSchema } from './portal-print.dto'

/**
 * Saving the kit's wording (2026-10-27): the wording picked, and the
 * manager's own words where they wrote them, held to the download's own rules
 * (guest languages only, a headline, one line of at most 60 characters, no control
 * characters). Which languages a print carries is the download's to say, not the
 * save's, so no language of the Portal is required here.
 */
export const savePortalPrintWordingInputSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
  callToAction: z.enum(PRINT_CALLS_TO_ACTION),
  customWords: printCustomWordsSchema.nullish(),
})

export type SavePortalPrintWordingInput = z.infer<
  typeof savePortalPrintWordingInputSchema
>
