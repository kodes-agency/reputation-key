import { ConnectGoogleButton } from '#/components/features/integration/connect-google-button'
import {
  ConfirmationDialog,
  ConfirmationTrigger,
} from '#/components/ui/confirmation-dialog'
import { StatusBadge, type StatusMap } from '#/components/ui/status-badge'
import type {
  GoogleAuthUrlInput,
  GoogleConnectionDto,
  GoogleConnectionStatus,
} from '#/contexts/integration/application/public-api'
import { googleConnectionLabel } from '#/components/features/integration/google-account-selector/google-connection-label'
import {
  accountEmailConsentForConnection,
  reauthorizationForConnection,
} from './google-connection-authorization'

type Props = Readonly<{
  connection: GoogleConnectionDto
  /** Starts a Google authorization: the page's one request, which every button here uses. */
  getAuthUrl: (opts: { data: GoogleAuthUrlInput }) => Promise<{ url: string }>
  /** Another authorization is starting; this row waits for it. */
  authorizationPending: boolean
  disconnectPending: boolean
  /** Rejects with the refusal, which the confirmation says in place. */
  onDisconnect: (connectionId: string) => Promise<unknown>
}>

const CONNECTION_STATUS: StatusMap<GoogleConnectionStatus> = {
  pending: { label: 'Connecting…', tone: 'neutral' },
  active: { label: 'Connected', tone: 'positive' },
  degraded: { label: 'Temporarily unavailable', tone: 'warn' },
  reauth_required: { label: 'Needs attention', tone: 'warn' },
  disconnecting: { label: 'Disconnecting…', tone: 'neutral' },
  disconnected: { label: 'Disconnected', tone: 'neutral' },
  failed: { label: 'Connection unavailable', tone: 'negative' },
}

export function GoogleConnectionSettingsRow({
  connection,
  getAuthUrl,
  authorizationPending,
  disconnectPending,
  onDisconnect,
}: Props) {
  const reauthorization = reauthorizationForConnection(connection)
  const accountEmailConsent = accountEmailConsentForConnection(connection)

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Google Business Profile</p>
          <StatusBadge status={connection.status} map={CONNECTION_STATUS} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {googleConnectionLabel(connection)}
        </p>
        {reauthorization ? (
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Google needs your permission again to keep this connection working.
          </p>
        ) : accountEmailConsent ? (
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Sign in with the same Google account once more to show which account this is.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {reauthorization ? (
          <ConnectGoogleButton
            getAuthUrl={getAuthUrl}
            request={reauthorization}
            label="Reauthorize"
            variant="outline"
            size="sm"
            disabled={authorizationPending}
          />
        ) : accountEmailConsent ? (
          <ConnectGoogleButton
            getAuthUrl={getAuthUrl}
            request={accountEmailConsent}
            label="Show account email"
            variant="outline"
            size="sm"
            disabled={authorizationPending}
          />
        ) : null}
        {/* Revokes Google's access and removes what the account imported, for
            every Property that uses it: higher blast radius than the
            Property-level disconnect, which already confirms. */}
        <ConfirmationDialog
          trigger={
            <ConfirmationTrigger
              tone="destructive"
              size="sm"
              disabled={disconnectPending}
            >
              Disconnect
            </ConfirmationTrigger>
          }
          title="Disconnect this Google account?"
          description="RepKey stops syncing and replying through this account for every property that uses it, revokes its access, and removes the reviews and replies it imported. Nothing is deleted on Google."
          cancelLabel="Keep connected"
          confirmLabel="Disconnect account"
          pendingLabel="Disconnecting…"
          tone="destructive"
          onConfirm={() => onDisconnect(connection.id)}
        />
      </div>
    </div>
  )
}
