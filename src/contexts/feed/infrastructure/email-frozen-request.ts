// The provider request an immediate email was frozen with, as stored on its
// queue row. A value that does not parse reads as absent: the row then has no
// frozen request, and the sender treats an attempted row without one as a
// legacy attempt it must not repeat.

import { z } from 'zod/v4'
import type { FrozenEmailRequest } from '../domain/notification-types'

const frozenEmailRequestSchema = z.object({
  to: z.string().min(1),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  headers: z.record(z.string(), z.string()),
  replyTo: z.string().min(1).nullable(),
})

export const readFrozenEmailRequest = (stored: unknown): FrozenEmailRequest | null => {
  const parsed = frozenEmailRequestSchema.safeParse(stored)
  return parsed.success ? parsed.data : null
}

/** Exactly the fields that are stored, and nothing else. */
export const frozenEmailRequest = (request: FrozenEmailRequest): FrozenEmailRequest => ({
  to: request.to,
  subject: request.subject,
  html: request.html,
  text: request.text,
  headers: { ...request.headers },
  replyTo: request.replyTo,
})
