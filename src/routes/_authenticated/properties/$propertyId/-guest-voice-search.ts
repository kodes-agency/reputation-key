import { z } from 'zod/v4'

// Route config is first-paint code. Bound optional tokens here, then normalize the
// complete UUID/polarity/reason/topic target in the lazy page before any detail read.
const token = z.string().max(64).optional().catch(undefined)
export const guestVoiceDetailSearch = {
  issue: token,
  sense: token,
  concern: token,
  reason: token,
  topic: token,
}
export type GuestVoiceDetailSearch = z.infer<z.ZodObject<typeof guestVoiceDetailSearch>>
