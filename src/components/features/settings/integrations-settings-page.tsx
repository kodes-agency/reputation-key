// Integrations settings page — Google Business Profile connection management.
// Lists connected Google accounts with their status and offers connect/disconnect.
// Every way of starting the OAuth ceremony is the one `ConnectGoogleButton`, which
// fetches the URL from the server (state signed server-side) and redirects to Google;
// disconnect revokes the connection for this org.

import { Plug } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { EmptyState } from '#/components/ui/empty-state'
import type { Action } from '#/components/hooks/use-action'
import { ConnectGoogleButton } from '#/components/features/integration/connect-google-button'
import type {
  GoogleAuthUrlInput,
  GoogleConnectionDto,
} from '#/contexts/integration/application/public-api'
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
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Google Business Profile</CardTitle>
        <CardDescription>
          Connect Google accounts to import reviews and business locations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connections.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="Not connected"
            description="Connect a Google account to start importing your business profile data."
            action={<ConnectGoogleButton getAuthUrl={connectGoogle} />}
          />
        ) : (
          <>
            <div className="divide-y rounded-lg border">
              {connections.map((connection) => (
                <GoogleConnectionSettingsRow
                  key={connection.id}
                  connection={connection}
                  getAuthUrl={connectGoogle}
                  authorizationPending={connectGoogle.isPending}
                  disconnectPending={disconnectGoogle.isPending}
                  // The confirmation stays open and says a refusal itself.
                  onDisconnect={(connectionId) =>
                    disconnectGoogle({ data: { connectionId } })
                  }
                />
              ))}
            </div>
            <ConnectGoogleButton
              getAuthUrl={connectGoogle}
              label="Connect another account"
              disabled={connectGoogle.isPending}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}
