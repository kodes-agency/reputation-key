import { getGuestPortalCopy } from './guest-language-pack'
import type { GuestResponseFormProps } from './guest-response-form-types'
import type { GuestResponseFormViewProps } from './guest-response-form-view'
import { useGuestResponseController } from './use-guest-response-controller'

/**
 * Binds the guest response actions to the session and returns the finished
 * props of the pure form view. The state, the nonce rotation and every server
 * call live here, so the view below it never sees an action.
 */
export function useGuestResponseFormView(
  props: GuestResponseFormProps,
): GuestResponseFormViewProps {
  const copy = getGuestPortalCopy(props.locale ?? 'en', props.languagePackVersion)
  const { activeCsrfNonce, ...viewProps } = useGuestResponseController(props, copy)
  return {
    availability: props.availability ?? 'available',
    copy,
    ...viewProps,
    secondaryLinks: props.secondaryLinks?.(activeCsrfNonce),
  }
}
