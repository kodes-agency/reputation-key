import { z } from 'zod/v4'

/** The print kit read: which Portal's look and languages to show. */
export const portalPrintKitInputSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
})
