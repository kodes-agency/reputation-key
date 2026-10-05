// The one button that starts a Google authorization (UI consistency scan: FORM-13,
// ACT-09). Connecting a new account, connecting another, reauthorizing one and showing
// an account's email are the same ceremony: ask the server for the sign-in address, then
// go there. The button owns the request, the glyph for adding an account, the pending
// state (a spinner on the Button, its label unchanged) and the failure, which is a toast
// because starting the ceremony is an immediate action. A place chooses the words
// (`label`) and the look (`variant`, `size`), never the behaviour.
import { useCallback } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAction } from '#/components/hooks/use-action'
import { actionFailureMessage } from '#/components/hooks/use-action-mutation'
import { Button, type ButtonProps } from '#/components/ui/button'
import type { GoogleAuthUrlInput } from '#/contexts/integration/application/public-api'
import {
  connectFailureMessage,
  NEW_GOOGLE_CONNECTION_AUTHORIZATION,
} from './connect-google-request'

type Props = Readonly<{
  getAuthUrl: (opts: { data: GoogleAuthUrlInput }) => Promise<{ url: string }>
  /** What to authorize; a new Organization-owned connection unless it says otherwise. */
  request?: GoogleAuthUrlInput
  label?: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  disabled?: boolean
}>

export function ConnectGoogleButton({
  getAuthUrl,
  request = NEW_GOOGLE_CONNECTION_AUTHORIZATION,
  label = 'Connect Google',
  variant,
  size,
  disabled = false,
}: Props) {
  const connect = useAction(getAuthUrl)

  const handleClick = useCallback(async () => {
    try {
      const result = await connect({ data: request })
      window.location.href = result.url
    } catch (error) {
      // Catching it here also keeps the click handler from an unhandled rejection.
      toast.error(actionFailureMessage(connectFailureMessage(request))(error))
    }
  }, [connect, request])

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={() => void handleClick()}
      pending={connect.isPending}
      disabled={disabled}
    >
      {request.connectionMode === 'new' ? <Plus aria-hidden="true" /> : null}
      {label}
    </Button>
  )
}
