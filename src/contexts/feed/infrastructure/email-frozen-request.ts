// The provider request an immediate email was frozen with, as stored on its
// queue row. A value that does not parse reads as absent: the row then has no
// frozen request, and the sender treats an attempted row without one as a
// legacy attempt it must not repeat.

import { z } from 'zod/v4'
import type { FrozenEmailRequest } from '../domain/notification-types'
import { copyFrozenRequestBase, frozenRequestBaseShape } from './frozen-request-base'

const frozenEmailRequestSchema = z.object({
  ...frozenRequestBaseShape,
  replyTo: z.string().min(1).nullable(),
})

export const readFrozenEmailRequest = (stored: unknown): FrozenEmailRequest | null => {
  const parsed = frozenEmailRequestSchema.safeParse(stored)
  return parsed.success ? parsed.data : null
}

/** Exactly the fields that are stored, and nothing else. */
export const frozenEmailRequest = (request: FrozenEmailRequest): FrozenEmailRequest => ({
  ...copyFrozenRequestBase(request),
  replyTo: request.replyTo,
})
