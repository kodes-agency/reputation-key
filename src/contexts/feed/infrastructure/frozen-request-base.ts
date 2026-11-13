// The fields every frozen provider request carries, whether it was frozen for
// an immediate email or for a digest batch.

import { z } from 'zod/v4'

export const frozenRequestBaseShape = {
  to: z.string().min(1),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  headers: z.record(z.string(), z.string()),
}

type FrozenRequestBase = Readonly<{
  to: string
  subject: string
  html: string
  text: string
  headers: Readonly<Record<string, string>>
}>

/** The shared fields as a fresh object, so no stored headers are aliased. */
export const copyFrozenRequestBase = (request: FrozenRequestBase) => ({
  to: request.to,
  subject: request.subject,
  html: request.html,
  text: request.text,
  headers: { ...request.headers },
})
