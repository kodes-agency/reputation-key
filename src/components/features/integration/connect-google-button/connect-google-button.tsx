import { useCallback } from 'react'
import { useAction } from '#/components/hooks/use-action'
import { Button } from '#/components/ui/button'
import { Loader2 } from 'lucide-react'
import type { GoogleAuthUrlInput } from '#/contexts/integration/application/public-api'

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
    } catch {
      // useAction retains the rejection for the alert below. Catching it here
      // keeps the click handler from producing an unhandled rejection.
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
      {connect.error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          Failed to connect Google account. Please try again.
        </p>
      ) : null}
    </div>
  )
}
