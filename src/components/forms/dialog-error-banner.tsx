import { FormErrorBanner } from './form-error-banner'
import { useState } from 'react'

/**
 * The banner of a dialog's submit, directly above its footer. It shows an error
 * from an attempt made since the dialog opened, not the refusal a mutation that
 * lives in the page still holds from the last time it was open: render it inside
 * the dialog's content, which mounts when the dialog opens.
 */
export function DialogErrorBanner({ error }: Readonly<{ error: unknown }>) {
  return <FormErrorBanner error={useFreshError(error)} />
}

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
