import { z } from 'zod/v4'
// Route config is first-paint code; complete target validation lives in the lazy page.
export const guestVoiceDetailSearch = {
  detail: z.string().max(64).optional().catch(undefined),
}
export type GuestVoiceDetailSearch = z.infer<z.ZodObject<typeof guestVoiceDetailSearch>>
