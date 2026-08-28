// Integrations settings page — Google Business Profile connection management.
// Lists connected Google accounts with their status and offers connect/disconnect.
// Connect fetches the OAuth URL from the server (state signed server-side) and
// redirects to Google; disconnect revokes the connection for this org.

import { toast } from 'sonner'
import { Plug, Plus } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import type { Action } from '#/components/hooks/use-action'
import type {
  GoogleAuthUrlInput,
  GoogleConnectionDto,
} from '#/contexts/integration/application/public-api'
import { NEW_GOOGLE_CONNECTION_AUTHORIZATION } from './google-connection-authorization'
import { GoogleConnectionSettingsRow } from './google-connection-settings-row'

type ConnectInput = Readonly<{ data: GoogleAuthUrlInput }>
type DisconnectInput = Readonly<{ data: Readonly<{ connectionId: string }> }>

type Props = Readonly<{
  connections: readonly GoogleConnectionDto[]
  connectGoogle: Action<ConnectInput, { url: string }>
  disconnectGoogle: Action<DisconnectInput, { connection: GoogleConnectionDto }>
}>

export function IntegrationsSettingsPage({
  connections,
  connectGoogle,
  disconnectGoogle,
}: Props) {
  const onAuthorize = async (input: GoogleAuthUrlInput) => {
    try {
      const { url } = await connectGoogle({ data: input })
      window.location.href = url
    } catch {
      toast.error(
        input.connectionMode === 'reauth'
          ? 'Could not start Google reauthorization'
          : 'Could not start Google connection',
      )
    }
  }

  const onDisconnect = async (connectionId: string) => {
    try {
      await disconnectGoogle({ data: { connectionId } })
    } catch {
      toast.error('Failed to disconnect Google account')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Business Profile</CardTitle>
        <CardDescription>
          Connect Google accounts to import reviews and business locations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connections.length === 0 ? (
          <EmptyState icon={Plug} title="Not connected">
            <p className="text-sm text-muted-foreground">
              Connect a Google account to start importing your business profile data.
            </p>
            <Button
              onClick={() => void onAuthorize(NEW_GOOGLE_CONNECTION_AUTHORIZATION)}
              disabled={connectGoogle.isPending}
            >
              <Plus className="size-4" />
              {connectGoogle.isPending ? 'Connecting…' : 'Connect Google'}
            </Button>
          </EmptyState>
        ) : (
          <>
            <div className="divide-y rounded-lg border">
              {connections.map((connection) => (
                <GoogleConnectionSettingsRow
                  key={connection.id}
                  connection={connection}
                  authorizationPending={connectGoogle.isPending}
                  disconnectPending={disconnectGoogle.isPending}
                  onReauthorize={(request) => void onAuthorize(request)}
                  onDisconnect={(connectionId) => void onDisconnect(connectionId)}
                />
              ))}
            </div>
            <Button
              onClick={() => void onAuthorize(NEW_GOOGLE_CONNECTION_AUTHORIZATION)}
              disabled={connectGoogle.isPending}
            >
              <Plus className="size-4" />
              {connectGoogle.isPending ? 'Connecting…' : 'Connect another account'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
