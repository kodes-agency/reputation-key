import { useCallback } from 'react'
import { toast } from 'sonner'
import { useAction } from '#/components/hooks/use-action'
import { Button } from '#/components/ui/button'
import { Loader2 } from 'lucide-react'
import type { GoogleAuthUrlInput } from '#/contexts/integration/application/public-api'
import { actionFailureMessage } from '#/components/hooks/use-action-mutation'

const CONNECT_FAILED = "Couldn't connect your Google account."

type NewGoogleAuthorization = Extract<GoogleAuthUrlInput, { connectionMode: 'new' }>

type Props = Readonly<{
  visibility?: 'organization'
  getAuthUrl: (opts: { data: NewGoogleAuthorization }) => Promise<{ url: string }>
  disabled?: boolean
}>

export function ConnectGoogleButton({
  visibility = 'organization',
  getAuthUrl,
  disabled = false,
}: Props) {
  const connect = useAction(getAuthUrl)

  const handleClick = useCallback(async () => {
    try {
      const result = await connect({
        data: {
          visibility,
          connectionMode: 'new',
          targetConnectionId: null,
        },
      })
      window.location.href = result.url
    } catch (error) {
      // Connecting is an immediate action, so a failure is a toast. Catching it
      // here also keeps the click handler from an unhandled rejection.
      toast.error(actionFailureMessage(CONNECT_FAILED)(error))
    }
  }, [connect, visibility])

  return (
    <div>
      <Button
        onClick={() => void handleClick()}
        disabled={disabled || connect.isPending}
        aria-busy={connect.isPending}
      >
        {connect.isPending && (
          <Loader2
            className="mr-2 size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        Connect Google Account
      </Button>
    </div>
  )
}
