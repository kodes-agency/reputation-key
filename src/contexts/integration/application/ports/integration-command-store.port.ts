// Integration command store — atomic integration state mutation + outbox
// record (BQC-3.5).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the google_connections /
// gbp_import_jobs state write and the outbox_events fact in ONE PostgreSQL
// transaction, then emits on the in-process bus after commit (expand-phase
// dual path until the durable switch).

import type { OrganizationId } from '#/shared/domain/ids'
import type {
  GbpImportJobId,
  GbpImportJobStatus,
  GoogleConnection,
  GoogleConnectionId,
  GoogleConnectionVisibility,
} from '../../domain/types'
import type {
  IntegrationGoogleAccountConnected,
  IntegrationGoogleAccountDisconnected,
  IntegrationGoogleConnectionVisibilityChanged,
  IntegrationPropertyImportCompleted,
} from '../../domain/events'

/**
 * New connection insert + google_account.connected fact in one transaction.
 * The global googleAccountId unique index backstops the one-account-one-org
 * invariant; a violation surfaces as UniqueViolationError (the use case's
 * raced-connect fallback contract) and records NO fact.
 */
export type ConnectGoogleAccountCommand = Readonly<{
  connection: GoogleConnection
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
  encryptedRefreshToken: string
  tokenExpiresAt: Date
  visibility: GoogleConnectionVisibility
  event: IntegrationGoogleAccountConnected
}>

/**
 * Disconnect: status→disconnected + identifier/secret redaction +
 * google_account.disconnected fact in one transaction. The gbp_cache purge
 * and the source-content retention purge stay OUTSIDE (cross-system cleanup;
 * the durable disconnected fact + redaction are the recovery record).
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

/**
 * Import-job terminal status + property_import.completed fact in one
 * transaction (the pre-BQC-3.5 use case updated the status and then
 * best-effort bus-emitted the fact — never recorded).
 */
export type RecordImportCompletedCommand = Readonly<{
  organizationId: OrganizationId
  importJobId: GbpImportJobId
  finalStatus: GbpImportJobStatus
  now: Date
  event: IntegrationPropertyImportCompleted
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
  recordImportCompleted(command: RecordImportCompletedCommand): Promise<void>
}>
