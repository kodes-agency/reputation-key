import { useState } from 'react'

/**
 * The error of an action the person has submitted since this body mounted.
 *
 * A dialog's body mounts when the dialog opens, but the mutation behind it
 * usually lives in the page and keeps its last error until the next attempt, so
 * a refused invitation greeted the next person to open "Invite member" with the
 * old refusal. The error already on the mutation at mount is that old one; any
 * error after it is a new attempt's (every failure is a new Error), and shows.
 * Pass the result to `FormErrorBanner`.
 */
export function useFreshError(error: unknown): unknown {
  const [heldAtMount] = useState(error)
  return error === heldAtMount ? null : error
}
