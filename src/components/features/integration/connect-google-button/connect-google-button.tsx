import { useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '#/components/ui/button'
import { Loader2 } from 'lucide-react'
import { getGoogleAuthUrl } from '#/contexts/integration/server/google-connections'

interface ConnectGoogleButtonProps {
  visibility?: 'private' | 'organization'
}

export function ConnectGoogleButton({
  visibility = 'private',
}: ConnectGoogleButtonProps) {
  const getAuthUrl = useServerFn(getGoogleAuthUrl)
  const [error, setError] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  const handleClick = async () => {
    try {
      setError(null)
      setIsConnecting(true)
      const result = await getAuthUrl({ data: { visibility } })
      window.location.href = result.url
    } catch (err) {
      console.error('Failed to connect Google account:', err)
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
