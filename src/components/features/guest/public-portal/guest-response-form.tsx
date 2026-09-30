import { GuestResponseFormView } from './guest-response-form-view'
import type { GuestResponseFormProps } from './guest-response-form-types'
import { useGuestResponseFormView } from './use-guest-response-form-view'
export type {
  GuestResponseAction,
  GuestResponseFormProps,
} from './guest-response-form-types'

export function GuestResponseForm(props: GuestResponseFormProps) {
  return <GuestResponseFormView {...useGuestResponseFormView(props)} />
}
