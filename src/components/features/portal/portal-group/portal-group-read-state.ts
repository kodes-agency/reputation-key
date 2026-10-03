// What the group page knows about one of its side reads (the goal, the history):
// not for this reader, on its way, failed, or here. A side read never holds the
// page back, and a capability that is deliberately off is not a failure.
import { isDarkCapabilityDenial } from '#/shared/auth/capability-denial'

export type ReadState<T> =
  | Readonly<{ status: 'off' }>
  | Readonly<{ status: 'loading' }>
  /** `retrying`: Try again is reading, so the failure stays on screen with its button busy. */
  | Readonly<{ status: 'failed'; retrying: boolean }>
  | Readonly<{ status: 'ready'; data: T }>

export function readStateOf<T>(
  facts: Readonly<{
    allowed: boolean
    error: unknown
    data: T | undefined
    retrying?: boolean
  }>,
): ReadState<T> {
  if (!facts.allowed) return { status: 'off' }
  if (facts.data !== undefined) return { status: 'ready', data: facts.data }
  if (facts.error === null || facts.error === undefined) return { status: 'loading' }
  return isDarkCapabilityDenial(facts.error)
    ? { status: 'off' }
    : { status: 'failed', retrying: facts.retrying === true }
}
