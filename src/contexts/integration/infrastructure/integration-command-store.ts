// Atomic integration command store (BQC-3.5).
//
// One PostgreSQL transaction per command: google_connections state mutation
// plus outbox_events insert. After commit, the in-process EventBus receives
// the same fact; a crash after commit is recovered by the durable relay.

import { and, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import { googleOauthExchangeAttempts } from '#/shared/db/schema/google-content-control.schema'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAfterCommit, insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { integrationError } from '../domain/errors'
import { uniqueViolationError } from '../application/ports/google-connection.repository'
import {
  googleConnectionFromRow,
  googleConnectionToInsert,
} from './mappers/google-connection.mapper'
import type {
  ConnectGoogleAccountCommand,
  DisconnectGoogleAccountCommand,
  IntegrationCommandStore,
  ReconnectGoogleAccountCommand,
  UpdateConnectionVisibilityCommand,
} from '../application/ports/integration-command-store.port'
import {
  applyOrganizationGoogleCredentialHome,
  type ApplyOrganizationGoogleCredentialHome,
} from './organization-google-credential-home-command'

/** True when a Postgres unique-constraint violation (SQLSTATE 23505) caused the error. */
function isPgUniqueViolation(err: unknown): boolean {
  // drizzle wraps driver errors in DrizzleQueryError — the SQLSTATE lives on
  // the cause (older call sites check the top level only; accept both).
  if (typeof err !== 'object' || err === null) return false
  const code = (err as { code?: unknown }).code
  if (code === '23505') return true
  const cause = (err as { cause?: unknown }).cause
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: unknown }).code === '23505'
  )
}

type GoogleConnectionInsert = typeof googleConnections.$inferInsert
type GoogleConnectionUpdateSet = {
  [K in keyof GoogleConnectionInsert]?: GoogleConnectionInsert[K] | SQL
}

/**
 * Update the google_connections row for (organizationId, connectionId)
 * inside the command transaction (single source for the guarded connection
 * updates, BQC-5.9 E16). Callers chain .returning(...) as needed.
 */
function updateConnectionRow(
  tx: Tx,
  command: Readonly<{ organizationId: string; connectionId: string }>,
  set: GoogleConnectionUpdateSet,
) {
  return tx
    .update(googleConnections)
    .set(set)
    .where(
      and(
        eq(googleConnections.organizationId, command.organizationId),
        eq(googleConnections.id, command.connectionId),
      ),
    )
}

async function completeOAuthExchangeAttempt(
  tx: Tx,
  input: Readonly<{
    attemptId: string | undefined
    organizationId: string
    connectionId: string
    initiatorUserId: string
    now: Date
  }>,
): Promise<void> {
  if (!input.attemptId) return
  const rows = await tx
    .update(googleOauthExchangeAttempts)
    .set({
      state: 'completed',
      encryptedResult: null,
      responseExpiresAt: null,
      applyLeaseExpiresAt: null,
      terminalAt: input.now,
      outcomeCode: 'connection_committed',
      updatedAt: input.now,
    })
    .where(
      and(
        eq(googleOauthExchangeAttempts.id, input.attemptId),
        eq(googleOauthExchangeAttempts.organizationId, input.organizationId),
        eq(googleOauthExchangeAttempts.connectionId, input.connectionId),
        eq(googleOauthExchangeAttempts.initiatorUserId, input.initiatorUserId),
        eq(googleOauthExchangeAttempts.state, 'applying'),
      ),
    )
    .returning({ id: googleOauthExchangeAttempts.id })
  if (!rows[0]) {
    throw integrationError('oauth_failed', 'Google OAuth recovery state changed')
  }
}

export const createAtomicIntegrationCommandStore = (
  db: Database,
  events: EventBus,
  clock: Clock,
  options?: Readonly<{
    applyCredentialHome?: ApplyOrganizationGoogleCredentialHome
  }>,
): IntegrationCommandStore => {
  const applyCredentialHome =
    options?.applyCredentialHome ?? applyOrganizationGoogleCredentialHome
  return {
    connectGoogleAccount: async (command: ConnectGoogleAccountCommand) => {
      return trace('integration.commandStore.connectGoogleAccount', async () => {
        if (
          command.connection.credentialHomeCellId === null ||
          command.connection.credentialHomePolicyVersion === null ||
          command.connection.credentialHomeAuthorityGeneration === null ||
          command.connection.credentialHomeAuthorityGeneration !==
            command.credentialHomeBinding.authorityGeneration
        ) {
          throw integrationError('oauth_failed', 'Google credential home is unavailable')
        }
        try {
          await db.transaction(async (tx) => {
            await applyCredentialHome(tx, {
              organizationId: command.connection.organizationId,
              targetConnectionId: null,
              requested: command.credentialHomeBinding,
              reason: 'new_grant',
              changedBy: command.event.userId,
              changeTicket: null,
              now: command.event.occurredAt,
            })
            await tx
              .insert(googleConnections)
              .values(googleConnectionToInsert(command.connection))
            await completeOAuthExchangeAttempt(tx, {
              attemptId: command.exchangeAttemptId,
              organizationId: command.connection.organizationId,
              connectionId: command.connection.id,
              initiatorUserId: command.event.userId,
              now: command.event.occurredAt,
            })
            await insertOutboxRow(tx, command.event)
          })
        } catch (err) {
          // Global one-account-one-org race — the use case's fallback contract.
          if (isPgUniqueViolation(err)) {
            throw uniqueViolationError('Duplicate Google connection identity')
          }
          throw err
        }
        await emitAfterCommit(events, command.event)
      })
    },

    reconnectGoogleAccount: async (command: ReconnectGoogleAccountCommand) => {
      return trace('integration.commandStore.reconnectGoogleAccount', async () => {
        let updated: typeof googleConnections.$inferSelect
        try {
          updated = await db.transaction(async (tx) => {
            await applyCredentialHome(tx, {
              organizationId: command.organizationId,
              targetConnectionId: command.connectionId,
              requested: command.credentialHome,
              reason: command.credentialHomeReason,
              changedBy: command.event.userId,
              changeTicket: null,
              now: command.event.occurredAt,
            })
            const now = clock()
            const rows = await updateConnectionRow(tx, command, {
              googleSubject: command.googleSubject,
              encryptedAccessToken: command.encryptedAccessToken,
              encryptedRefreshToken: command.encryptedRefreshToken,
              tokenExpiresAt: command.tokenExpiresAt,
              scopes: [...command.scopes],
              status: 'active',
              visibility: command.visibility,
              credentialUseState: 'active',
              credentialAuthorizedBy: command.event.userId,
              credentialAuthorizedAt: command.event.occurredAt,
              cleanupMaterialDeadlineAt: null,
              lifecycleVersion: sql`${googleConnections.lifecycleVersion} + 1`,
              accessVersion: sql`${googleConnections.accessVersion} + 1`,
              credentialGeneration: sql`${googleConnections.credentialGeneration} + 1`,
              credentialHomeCellId: command.credentialHome.homeCellId,
              credentialHomePolicyVersion: command.credentialHome.cataloguePolicyVersion,
              credentialHomeAuthorityGeneration:
                command.credentialHome.authorityGeneration,
              updatedAt: now,
            }).returning()
            if (!rows[0]) {
              throw integrationError(
                'connection_not_found',
                'Google connection not found',
              )
            }
            await completeOAuthExchangeAttempt(tx, {
              attemptId: command.exchangeAttemptId,
              organizationId: command.organizationId,
              connectionId: command.connectionId,
              initiatorUserId: command.event.userId,
              now: command.event.occurredAt,
            })
            await insertOutboxRow(tx, command.event)
            return rows[0]
          })
        } catch (error) {
          if (isPgUniqueViolation(error)) {
            throw uniqueViolationError('Duplicate Google connection identity')
          }
          throw error
        }
        await emitAfterCommit(events, command.event)
        return googleConnectionFromRow(updated)
      })
    },

    disconnectGoogleAccount: async (command: DisconnectGoogleAccountCommand) => {
      return trace('integration.commandStore.disconnectGoogleAccount', async () => {
        const redacted = await db.transaction(async (tx) => {
          const now = clock()
          const statusRows = await updateConnectionRow(tx, command, {
            status: 'disconnected',
            lifecycleVersion: sql`${googleConnections.lifecycleVersion} + 1`,
            updatedAt: now,
          }).returning({ id: googleConnections.id })
          if (!statusRows[0]) {
            throw integrationError('connection_not_found', 'Google connection not found')
          }
          // BQC-1.7: remove provider identifiers and secret material — the
          // row stays as a content-free audit fact.
          const redactedRows = await updateConnectionRow(tx, command, {
            encryptedAccessToken: 'redacted',
            encryptedRefreshToken: 'redacted',
            googleSubject: null,
            scopes: [],
            credentialUseState: 'none',
            cleanupMaterialDeadlineAt: null,
            accessVersion: sql`${googleConnections.accessVersion} + 1`,
            credentialGeneration: sql`${googleConnections.credentialGeneration} + 1`,
            updatedAt: now,
          }).returning()
          if (!redactedRows[0]) {
            throw integrationError('connection_not_found', 'Google connection not found')
          }
          await insertOutboxRow(tx, command.event)
          return redactedRows[0]
        })
        await emitAfterCommit(events, command.event)
        return googleConnectionFromRow(redacted)
      })
    },

    updateConnectionVisibility: async (command: UpdateConnectionVisibilityCommand) => {
      return trace('integration.commandStore.updateConnectionVisibility', async () => {
        const updated = await db.transaction(async (tx) => {
          const now = clock()
          const rows = await updateConnectionRow(tx, command, {
            visibility: command.visibility,
            accessVersion: sql`${googleConnections.accessVersion} + 1`,
            updatedAt: now,
          }).returning()
          if (!rows[0]) {
            throw integrationError('connection_not_found', 'Google connection not found')
          }
          await insertOutboxRow(tx, command.event)
          return rows[0]
        })
        await emitAfterCommit(events, command.event)
        return googleConnectionFromRow(updated)
      })
    },
  }
}
