import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Loader2 } from 'lucide-react'

type Props = Readonly<{
  visibility?: 'private' | 'organization'
  getAuthUrl: (opts: {
    data: { visibility: 'private' | 'organization' }
  }) => Promise<{ url: string }>
}>

export function ConnectGoogleButton({ visibility = 'private', getAuthUrl }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  const handleClick = async () => {
    try {
      setError(null)
      setIsConnecting(true)
      const result = await getAuthUrl({ data: { visibility } })
      window.location.href = result.url
    } catch {
      setError('Failed to connect Google account. Please try again.')
      setIsConnecting(false)
    }
  }

  return (
    <div>
      <Button onClick={handleClick} disabled={isConnecting} aria-busy={isConnecting}>
        {isConnecting && (
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
        )}
        Connect Google Account
      </Button>
      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
