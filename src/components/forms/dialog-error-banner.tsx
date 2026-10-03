import { FormErrorBanner } from './form-error-banner'
import { useFreshError } from './use-fresh-error'

/**
 * The banner of a dialog's submit, directly above its footer. It shows an error
 * from an attempt made since the dialog opened, not the refusal a mutation that
 * lives in the page still holds from the last time it was open: render it inside
 * the dialog's content, which mounts when the dialog opens.
 */
export function DialogErrorBanner({ error }: Readonly<{ error: unknown }>) {
  return <FormErrorBanner error={useFreshError(error)} />
}
