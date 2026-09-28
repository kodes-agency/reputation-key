// Integration command store — atomic integration state mutation + outbox
// record (BQC-3.5).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the google_connections state write
// and its durable outbox_events fact in one PostgreSQL transaction.

import type { OrganizationId } from '#/shared/domain/ids'
import type {
  GoogleConnection,
  GoogleConnectionId,
  GoogleConnectionVisibility,
} from '../../domain/types'
import type {
  IntegrationGoogleAccountConnected,
  IntegrationGoogleAccountDisconnected,
  IntegrationGoogleAccountReauthorizationRequired,
} from '../../domain/events'

/**
 * New connection insert + google_account.connected fact in one transaction.
 * The global Google-subject unique index backstops the one-account-one-org
 * invariant; a violation surfaces as UniqueViolationError (the use case's
 * raced-connect fallback contract) and records NO fact.
 */
export type ConnectGoogleAccountCommand = Readonly<{
  connection: GoogleConnection
  exchangeAttemptId?: string
  event: IntegrationGoogleAccountConnected
}>

/**
 * Reconnect (same org): tokens + status→active + visibility update +
 * google_account.connected fact in one transaction. Applies only to the exact
 * lifecycle, access and credential versions the OAuth ceremony was approved
 * against, so a disconnect, departure fence or other grant that committed
 * after the ceremony re-proved its target is never overwritten. Throws
 * `oauth_failed` when those versions moved and `connection_not_found` when the
 * row vanished — either way records NO fact.
 */
export type ReconnectGoogleAccountCommand = Readonly<{
  organizationId: OrganizationId
  connectionId: GoogleConnectionId
  expected: Readonly<{
    lifecycleVersion: number
    accessVersion: number
    credentialGeneration: number
  }>
  encryptedAccessToken: string
  googleSubject: string
  googleAccountEmail: string | null
  scopes: ReadonlyArray<string>
  encryptedRefreshToken: string
  tokenExpiresAt: Date
  visibility: GoogleConnectionVisibility
  exchangeAttemptId?: string
  event: IntegrationGoogleAccountConnected
}>

/**
 * Disconnect: status→disconnected + identifier/secret redaction +
 * google_account.disconnected fact in one transaction.
 * Throws `connection_not_found` when the row vanished — records NO fact.
 *
 * Deliberately not fenced on the credential or lifecycle versions it read: a
 * token refresh that commits meanwhile must not make a disconnect fail. It is
 * idempotent instead: a connection an overlapping disconnect already finished
 * is returned as it is, with NO second fact, and a governed disconnect still
 * inside its cleanup window is left to its attempt (`invalid_transition`).
 */
export type DisconnectGoogleAccountCommand = Readonly<{
  organizationId: OrganizationId
  connectionId: GoogleConnectionId
  event: IntegrationGoogleAccountDisconnected
}>

/**
 * Google refused the connection's refresh grant for good: status →
 * reauth_required + google_account.reauthorization_required fact in one
 * transaction. Applies only while the connection is still active on the
 * lifecycle and credential generations the refresh was admitted with, so a
 * reconnect, disconnect or departure fence that committed first is never
 * overwritten. Returns false, recording NO fact, when the fence does not match.
 */
export type RequireGoogleReauthorizationCommand = Readonly<{
  organizationId: OrganizationId
  connectionId: GoogleConnectionId
  expected: Readonly<{
    lifecycleVersion: number
    credentialGeneration: number
  }>
  event: IntegrationGoogleAccountReauthorizationRequired
}>

export type IntegrationCommandStore = Readonly<{
  connectGoogleAccount(command: ConnectGoogleAccountCommand): Promise<void>
  reconnectGoogleAccount(
    command: ReconnectGoogleAccountCommand,
  ): Promise<GoogleConnection>
  disconnectGoogleAccount(
    command: DisconnectGoogleAccountCommand,
  ): Promise<GoogleConnection>
  requireReauthorization(command: RequireGoogleReauthorizationCommand): Promise<boolean>
}>
