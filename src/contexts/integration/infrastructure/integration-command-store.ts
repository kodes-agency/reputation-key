// Atomic integration command store (BQC-3.5).
//
// One PostgreSQL transaction per command: google_connections / gbp_import_jobs
// state mutation + outbox_events insert. After commit: in-process EventBus
// emit for expand-phase legacy consumers.
//
// Crash contract:
// - Crash anywhere inside the transaction rolls back BOTH the state mutation
//   and the outbox row — no state/outbox split is ever observable (the
//   pre-BQC-3.5 disconnect could mark the row disconnected, purge, redact,
//   and STILL lose the fact between separate awaits).
// - Crash after commit but before the bus emit leaves a durable outbox row
//   for the relay; the emit is best-effort (failure-isolated, logged).
// - The gbp_cache purge and the source-content retention purge stay OUTSIDE
//   the disconnect transaction: the durable disconnected fact + redaction
//   are the recovery record for the cleanup machinery. (The gbp_cache purge
//   is PG-backed but idempotent cleanup; the review-side purge command
//   remains a noted gap for later.)

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import { gbpImportJobs } from '#/shared/db/schema/gbp-import-job.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { getLogger } from '#/shared/observability/logger'
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
  RecordImportCompletedCommand,
  UpdateConnectionVisibilityCommand,
} from '../application/ports/integration-command-store.port'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

async function emitAfterCommit(events: EventBus, event: DomainEvent): Promise<void> {
  // Expand-phase dual path: durable outbox already committed. Bus failure must
  // not roll back or hide the durable fact (relay will deliver when enabled).
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, eventId: event.eventId },
      'BQC-3.5: in-process emit failed after atomic outbox commit — durable row retained',
    )
  }
}

async function insertOutboxRow(tx: Tx, event: DomainEvent): Promise<void> {
  await tx.insert(outboxEvents).values({ ...toOutboxEvent(event), id: event.eventId })
}

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

export function createAtomicIntegrationCommandStore(
  db: Database,
  events: EventBus,
): IntegrationCommandStore {
  return {
    connectGoogleAccount: async (command: ConnectGoogleAccountCommand) => {
      return trace('integration.commandStore.connectGoogleAccount', async () => {
        try {
          await db.transaction(async (tx) => {
            await tx
              .insert(googleConnections)
              .values(googleConnectionToInsert(command.connection))
            await insertOutboxRow(tx, command.event)
          })
        } catch (err) {
          // Global one-account-one-org race — the use case's fallback contract.
          if (isPgUniqueViolation(err)) {
            throw uniqueViolationError(
              `Duplicate google connection for accountId=${command.connection.googleAccountId}`,
            )
          }
          throw err
        }
        await emitAfterCommit(events, command.event)
      })
    },

    reconnectGoogleAccount: async (command: ReconnectGoogleAccountCommand) => {
      return trace('integration.commandStore.reconnectGoogleAccount', async () => {
        const updated = await db.transaction(async (tx) => {
          const rows = await tx
            .update(googleConnections)
            .set({
              encryptedAccessToken: command.encryptedAccessToken,
              encryptedRefreshToken: command.encryptedRefreshToken,
              tokenExpiresAt: command.tokenExpiresAt,
              status: 'active',
              visibility: command.visibility,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(googleConnections.organizationId, command.organizationId as string),
                eq(googleConnections.id, command.connectionId as string),
              ),
            )
            .returning()
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

    disconnectGoogleAccount: async (command: DisconnectGoogleAccountCommand) => {
      return trace('integration.commandStore.disconnectGoogleAccount', async () => {
        const redacted = await db.transaction(async (tx) => {
          const statusRows = await tx
            .update(googleConnections)
            .set({ status: 'disconnected', updatedAt: new Date() })
            .where(
              and(
                eq(googleConnections.organizationId, command.organizationId as string),
                eq(googleConnections.id, command.connectionId as string),
              ),
            )
            .returning({ id: googleConnections.id })
          if (!statusRows[0]) {
            throw integrationError('connection_not_found', 'Google connection not found')
          }
          // BQC-1.7: remove provider identifiers and secret material — the
          // row stays as a content-free audit fact.
          const redactedRows = await tx
            .update(googleConnections)
            .set({
              encryptedAccessToken: 'redacted',
              encryptedRefreshToken: 'redacted',
              googleEmail: 'redacted',
              googleAccountId: `redacted:${command.connectionId as string}`,
              scopes: [],
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(googleConnections.organizationId, command.organizationId as string),
                eq(googleConnections.id, command.connectionId as string),
              ),
            )
            .returning()
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
          const rows = await tx
            .update(googleConnections)
            .set({ visibility: command.visibility, updatedAt: new Date() })
            .where(
              and(
                eq(googleConnections.organizationId, command.organizationId as string),
                eq(googleConnections.id, command.connectionId as string),
              ),
            )
            .returning()
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

    recordImportCompleted: async (command: RecordImportCompletedCommand) => {
      return trace('integration.commandStore.recordImportCompleted', async () => {
        await db.transaction(async (tx) => {
          await tx
            .update(gbpImportJobs)
            .set({ status: command.finalStatus, updatedAt: command.now })
            .where(
              and(
                eq(gbpImportJobs.organizationId, command.organizationId as string),
                eq(gbpImportJobs.id, command.importJobId as string),
              ),
            )
          await insertOutboxRow(tx, command.event)
        })
        await emitAfterCommit(events, command.event)
      })
    },
  }
}
