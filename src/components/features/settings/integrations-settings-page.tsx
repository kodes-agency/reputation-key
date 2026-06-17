// Integrations settings page — Google Business Profile connection management.
// Lists connected Google accounts with their status and offers connect/disconnect.
// Connect fetches the OAuth URL from the server (state signed server-side) and
// redirects to Google; disconnect revokes the connection for this org.

import { useState } from 'react'
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
import { Badge } from '#/components/ui/badge'
import { EmptyState } from '#/components/ui/empty-state'
import type { Action } from '#/components/hooks/use-action'
import type {
  GoogleConnectionDto,
  GoogleConnectionStatus,
} from '#/contexts/integration/application/public-api'

type ConnectInput = Readonly<{ data: Readonly<{ visibility: 'organization' }> }>
type DisconnectInput = Readonly<{ data: Readonly<{ connectionId: string }> }>

type Props = Readonly<{
  connections: readonly GoogleConnectionDto[]
  connectGoogle: Action<ConnectInput, { url: string }>
  disconnectGoogle: Action<DisconnectInput, { connection: GoogleConnectionDto }>
}>

const STATUS_META: Record<
  GoogleConnectionStatus,
  { label: string; variant: 'default' | 'secondary' }
> = {
  active: { label: 'Connected', variant: 'default' },
  disconnected: { label: 'Disconnected', variant: 'secondary' },
}

export function IntegrationsSettingsPage({
  connections,
  connectGoogle,
  disconnectGoogle,
}: Props) {
  const [connecting, setConnecting] = useState(false)

  const onConnect = async () => {
    setConnecting(true)
    try {
      const { url } = await connectGoogle({ data: { visibility: 'organization' } })
      window.location.href = url
    } catch {
      toast.error('Failed to start Google connection')
      setConnecting(false)
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
            <Button onClick={onConnect} disabled={connecting}>
              <Plus className="size-4" />
              {connecting ? 'Connecting…' : 'Connect Google'}
            </Button>
          </EmptyState>
        ) : (
          <>
            <div className="divide-y rounded-lg border">
              {connections.map((conn) => {
                const meta = STATUS_META[conn.status]
                return (
                  <div
                    key={conn.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{conn.googleEmail}</p>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Visibility: {conn.visibility}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onDisconnect(conn.id)}
                      disabled={disconnectGoogle.isPending}
                    >
                      Disconnect
                    </Button>
                  </div>
                )
              })}
            </div>
            <Button onClick={onConnect} disabled={connecting || connectGoogle.isPending}>
              <Plus className="size-4" />
              {connecting ? 'Connecting…' : 'Connect another account'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
