import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import type {
  GoogleAuthUrlInput,
  GoogleConnectionDto,
  GoogleConnectionStatus,
} from '#/contexts/integration/application/public-api'
import { reauthorizationForConnection } from './google-connection-authorization'

type ReauthorizationRequest = Extract<GoogleAuthUrlInput, { connectionMode: 'reauth' }>

type Props = Readonly<{
  connection: GoogleConnectionDto
  authorizationPending: boolean
  disconnectPending: boolean
  onReauthorize: (request: ReauthorizationRequest) => void
  onDisconnect: (connectionId: string) => void
}>

const STATUS_META: Record<
  GoogleConnectionStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' }
> = {
  pending: { label: 'Connecting…', variant: 'secondary' },
  active: { label: 'Connected', variant: 'default' },
  degraded: { label: 'Temporarily unavailable', variant: 'secondary' },
  reauth_required: { label: 'Needs attention', variant: 'secondary' },
  disconnecting: { label: 'Disconnecting…', variant: 'secondary' },
  disconnected: { label: 'Disconnected', variant: 'secondary' },
  failed: { label: 'Connection unavailable', variant: 'destructive' },
}

export function GoogleConnectionSettingsRow({
  connection,
  authorizationPending,
  disconnectPending,
  onReauthorize,
  onDisconnect,
}: Props) {
  const status = STATUS_META[connection.status]
  const reauthorization = reauthorizationForConnection(connection)

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Google Business Profile</p>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">Organization connection</p>
        {reauthorization ? (
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Google needs your permission again to keep this connection working.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {reauthorization ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReauthorize(reauthorization)}
            disabled={authorizationPending}
            aria-busy={authorizationPending}
          >
            Reauthorize
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDisconnect(connection.id)}
          disabled={disconnectPending}
        >
          Disconnect
        </Button>
      </div>
    </div>
  )
}
