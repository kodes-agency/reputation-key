// An id for a fact that is a function of what the fact is about, so recording the same
// fact again names the same row and the outbox refuses it (`insertOutboxRowIfNew`).
import { createHash } from 'node:crypto'

/**
 * A UUID derived from a namespace and the parts that identify the fact. Shaped as a
 * version-5 UUID (RFC 9562) over SHA-256, the way a name-based id is: version 5 in the
 * third group, the variant bits (10xx) on the fourth. Every kind of fact has a namespace
 * of its own, so no id derived for one kind can collide with another's, and the parts
 * are joined with a NUL so that `['ab', 'c']` and `['a', 'bc']` are different facts.
 */
export function derivedFactId(
  namespace: string,
  parts: readonly (string | number)[],
): string {
  const hex = createHash('sha256')
    .update([namespace, ...parts].join('\u0000'))
    .digest('hex')
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}
