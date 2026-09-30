import { GuestResponseFormView } from './guest-response-form-view'
import type { GuestResponseFormProps } from './guest-response-form-types'
import { getGuestPortalCopy } from './guest-language-pack'
import { useGuestResponseController } from './use-guest-response-controller'
export type {
  GuestResponseAction,
  GuestResponseFormProps,
} from './guest-response-form-types'

export function GuestResponseForm(props: GuestResponseFormProps) {
  const locale = props.locale ?? 'en'
  const copy = getGuestPortalCopy(locale, props.languagePackVersion)
  const controller = useGuestResponseController(props, copy)
  const { activeCsrfNonce, ...viewProps } = controller

  return (
    <GuestResponseFormView
      availability={props.availability ?? 'available'}
      copy={copy}
      {...viewProps}
      secondaryLinks={props.secondaryLinks?.(activeCsrfNonce)}
    />
  )
}
