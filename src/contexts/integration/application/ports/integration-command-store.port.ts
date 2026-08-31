// Integration command store — atomic integration state mutation + outbox
// record (BQC-3.5).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the google_connections state write
// and the outbox_events fact in ONE PostgreSQL transaction, then emits on the
// in-process bus after commit.

import type { OrganizationId } from '#/shared/domain/ids'
import type { GoogleCredentialHomeBinding } from '#/shared/domain/google-credential-home'
import type { GoogleCredentialHomeTransitionReason } from '../../domain/organizationGoogleCredentialHome'
import type {
  GoogleConnection,
  GoogleConnectionId,
  GoogleConnectionVisibility,
} from '../../domain/types'
import type {
  IntegrationGoogleAccountConnected,
  IntegrationGoogleAccountDisconnected,
  IntegrationGoogleConnectionVisibilityChanged,
} from '../../domain/events'

/**
 * New connection insert + google_account.connected fact in one transaction.
 * The global Google-subject unique index backstops the one-account-one-org
 * invariant; a violation surfaces as UniqueViolationError (the use case's
 * raced-connect fallback contract) and records NO fact.
 */
export type ConnectGoogleAccountCommand = Readonly<{
  connection: GoogleConnection
  credentialHomeBinding: GoogleCredentialHomeBinding
  exchangeAttemptId?: string
  event: IntegrationGoogleAccountConnected
}>

/**
 * Reconnect (same org): tokens + status→active + visibility update +
 * google_account.connected fact in one transaction. Throws
 * `connection_not_found` when the row vanished — records NO fact.
 */
export type ReconnectGoogleAccountCommand = Readonly<{
  organizationId: OrganizationId
  connectionId: GoogleConnectionId
  encryptedAccessToken: string
  googleSubject: string
  scopes: ReadonlyArray<string>
  encryptedRefreshToken: string
  tokenExpiresAt: Date
  visibility: GoogleConnectionVisibility
  credentialHome: GoogleCredentialHomeBinding
  credentialHomeReason: Extract<
    GoogleCredentialHomeTransitionReason,
    'credential_rotation' | 'governed_reconnect'
  >
  exchangeAttemptId?: string
  event: IntegrationGoogleAccountConnected
}>

/**
 * Disconnect: status→disconnected + identifier/secret redaction +
 * google_account.disconnected fact in one transaction.
 * Throws `connection_not_found` when the row vanished — records NO fact.
 */
export type DisconnectGoogleAccountCommand = Readonly<{
  organizationId: OrganizationId
  connectionId: GoogleConnectionId
  event: IntegrationGoogleAccountDisconnected
}>

/**
 * Visibility update + google_connection.visibility_changed fact in one
 * transaction. Throws `connection_not_found` when the row vanished —
 * records NO fact.
 */
export type UpdateConnectionVisibilityCommand = Readonly<{
  organizationId: OrganizationId
  connectionId: GoogleConnectionId
  visibility: GoogleConnectionVisibility
  event: IntegrationGoogleConnectionVisibilityChanged
}>

export type IntegrationCommandStore = Readonly<{
  connectGoogleAccount(command: ConnectGoogleAccountCommand): Promise<void>
  reconnectGoogleAccount(
    command: ReconnectGoogleAccountCommand,
  ): Promise<GoogleConnection>
  disconnectGoogleAccount(
    command: DisconnectGoogleAccountCommand,
  ): Promise<GoogleConnection>
  updateConnectionVisibility(
    command: UpdateConnectionVisibilityCommand,
  ): Promise<GoogleConnection>
}>
