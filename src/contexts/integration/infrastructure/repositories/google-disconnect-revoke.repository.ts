import { and, asc, eq, not, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  authorizationExecutionPermits,
  googleConnections,
  idempotencyReceipts,
} from '#/shared/db/schema'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { googleConnectionFromRow } from '../mappers/google-connection.mapper'
import type {
  GoogleDisconnectRevokeOutcome,
  GoogleDisconnectRevokeResult,
  GoogleDisconnectRevokeStore,
} from '../../application/google-disconnect-revoke'
import { GOOGLE_DISCONNECT_REVOKE_WINDOW_MS } from '../../application/google-disconnect-revoke'
import type { GoogleDisconnectRevokeAuthorization } from '../../application/google-provider-contract'
import type { GoogleConnection } from '../../domain/types'
import { integrationGoogleAccountDisconnected } from '../../domain/events'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'

const RECEIPT_SCOPE = 'google_disconnect_revoke'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SHA256 = /^[a-f0-9]{64}$/u
const OUTCOME_CODE = /^[a-z0-9_.-]{1,100}$/u

type AttemptState = 'active' | 'dispatching' | GoogleDisconnectRevokeOutcome

type AttemptRow = Readonly<{
  id: string
  organizationId: string
  connectionId: string
  initiatorUserId: string
  cleanupWorkPermitId: string | null
  state: AttemptState
  expectedLifecycleVersion: number
  expectedAccessVersion: number
  expectedCredentialGeneration: number
  credentialBinding: string | null
  cleanupDeadlineAt: Date
  activatedAt: Date
  dispatchingAt: Date | null
  terminalAt: Date | null
  outcomeCode: string | null
  createdAt: Date
  updatedAt: Date
}>

type AttemptPayload = Readonly<{
  id: string
  organizationId: string
  connectionId: string
  initiatorUserId: string
  cleanupWorkPermitId: string | null
  state: AttemptState
  expectedLifecycleVersion: number
  expectedAccessVersion: number
  expectedCredentialGeneration: number
  credentialBinding: string | null
  cleanupDeadlineAt: string
  activatedAt: string
  dispatchingAt: string | null
  terminalAt: string | null
  outcomeCode: string | null
  createdAt: string
  updatedAt: string
}>

const fail = <T>(
  code: Exclude<GoogleDisconnectRevokeResult<T>, { ok: true }>['code'],
): GoogleDisconnectRevokeResult<T> => ({ ok: false, code })
const success = <T>(value: T): GoogleDisconnectRevokeResult<T> => ({
  ok: true,
  value,
})

function requiredString(
  payload: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const value = payload[field]
  if (typeof value !== 'string')
    throw new Error('google_disconnect_revoke_receipt_invalid')
  return value
}

function nullableString(
  payload: Readonly<Record<string, unknown>>,
  field: string,
): string | null {
  const value = payload[field]
  if (value === null) return null
  if (typeof value !== 'string')
    throw new Error('google_disconnect_revoke_receipt_invalid')
  return value
}

function requiredInteger(
  payload: Readonly<Record<string, unknown>>,
  field: string,
): number {
  const value = payload[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('google_disconnect_revoke_receipt_invalid')
  }
  return value
}

function requiredDate(payload: Readonly<Record<string, unknown>>, field: string): Date {
  const parsed = new Date(requiredString(payload, field))
  if (Number.isNaN(parsed.getTime()))
    throw new Error('google_disconnect_revoke_receipt_invalid')
  return parsed
}

function nullableDate(
  payload: Readonly<Record<string, unknown>>,
  field: string,
): Date | null {
  const value = nullableString(payload, field)
  if (value === null) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()))
    throw new Error('google_disconnect_revoke_receipt_invalid')
  return parsed
}

function attemptFromPayload(payload: Readonly<Record<string, unknown>>): AttemptRow {
  const state = requiredString(payload, 'state')
  if (
    state !== 'active' &&
    state !== 'dispatching' &&
    state !== 'confirmed_not_sent' &&
    state !== 'confirmed_revoked' &&
    state !== 'cleanup_ambiguous'
  ) {
    throw new Error('google_disconnect_revoke_receipt_invalid')
  }
  return {
    id: requiredString(payload, 'id'),
    organizationId: requiredString(payload, 'organizationId'),
    connectionId: requiredString(payload, 'connectionId'),
    initiatorUserId: requiredString(payload, 'initiatorUserId'),
    cleanupWorkPermitId: nullableString(payload, 'cleanupWorkPermitId'),
    state,
    expectedLifecycleVersion: requiredInteger(payload, 'expectedLifecycleVersion'),
    expectedAccessVersion: requiredInteger(payload, 'expectedAccessVersion'),
    expectedCredentialGeneration: requiredInteger(
      payload,
      'expectedCredentialGeneration',
    ),
    credentialBinding: nullableString(payload, 'credentialBinding'),
    cleanupDeadlineAt: requiredDate(payload, 'cleanupDeadlineAt'),
    activatedAt: requiredDate(payload, 'activatedAt'),
    dispatchingAt: nullableDate(payload, 'dispatchingAt'),
    terminalAt: nullableDate(payload, 'terminalAt'),
    outcomeCode: nullableString(payload, 'outcomeCode'),
    createdAt: requiredDate(payload, 'createdAt'),
    updatedAt: requiredDate(payload, 'updatedAt'),
  }
}

const attemptPayload = (attempt: AttemptRow): AttemptPayload => ({
  ...attempt,
  cleanupDeadlineAt: attempt.cleanupDeadlineAt.toISOString(),
  activatedAt: attempt.activatedAt.toISOString(),
  dispatchingAt: attempt.dispatchingAt?.toISOString() ?? null,
  terminalAt: attempt.terminalAt?.toISOString() ?? null,
  createdAt: attempt.createdAt.toISOString(),
  updatedAt: attempt.updatedAt.toISOString(),
})

async function readAttemptForUpdate(tx: Tx, id: string): Promise<AttemptRow | null> {
  const [receipt] = await tx
    .select({ payload: idempotencyReceipts.payload })
    .from(idempotencyReceipts)
    .where(
      and(eq(idempotencyReceipts.scope, RECEIPT_SCOPE), eq(idempotencyReceipts.key, id)),
    )
    .for('update')
    .limit(1)
  return receipt ? attemptFromPayload(receipt.payload) : null
}

async function updateAttempt(tx: Tx, attempt: AttemptRow): Promise<boolean> {
  const updated = await tx
    .update(idempotencyReceipts)
    .set({ payload: attemptPayload(attempt) })
    .where(
      and(
        eq(idempotencyReceipts.scope, RECEIPT_SCOPE),
        eq(idempotencyReceipts.key, attempt.id),
      ),
    )
    .returning({ key: idempotencyReceipts.key })
  return updated.length === 1
}

type FrozenVersions = Readonly<{
  lifecycleVersion: number
  accessVersion: number
  credentialGeneration: number
}>

function frozenVersions(
  authorization: GoogleDisconnectRevokeAuthorization,
): FrozenVersions | null {
  const lifecycleVersion = authorization.authorizationVector.connectionLifecycleVersion
  const accessVersion = authorization.authorizationVector.connectionAccessVersion
  const credentialGeneration = authorization.authorizationVector.credentialGeneration
  if (
    typeof lifecycleVersion !== 'number' ||
    !Number.isSafeInteger(lifecycleVersion) ||
    lifecycleVersion < 1 ||
    typeof accessVersion !== 'number' ||
    !Number.isSafeInteger(accessVersion) ||
    accessVersion < 1 ||
    typeof credentialGeneration !== 'number' ||
    !Number.isSafeInteger(credentialGeneration) ||
    credentialGeneration < 1
  ) {
    return null
  }
  return { lifecycleVersion, accessVersion, credentialGeneration }
}

function exactScope(
  attempt: AttemptRow,
  input: Readonly<{
    organizationId: string
    connectionId: string
    initiatorUserId: string
  }>,
): boolean {
  return (
    attempt.organizationId === input.organizationId &&
    attempt.connectionId === input.connectionId &&
    attempt.initiatorUserId === input.initiatorUserId
  )
}

type ConnectionRow = typeof googleConnections.$inferSelect
type PermitRow = typeof authorizationExecutionPermits.$inferSelect
type PrepareInput = Parameters<GoogleDisconnectRevokeStore['prepare']>[0]
type AcquireDispatchInput = Parameters<GoogleDisconnectRevokeStore['acquireDispatch']>[0]

function isWellFormedPrepareRequest(input: PrepareInput): boolean {
  const disconnectRevoke = input.authorization.disconnectRevoke
  return (
    UUID.test(input.attemptId) &&
    SHA256.test(input.credentialBinding) &&
    input.authorization.propertyId === null &&
    Boolean(disconnectRevoke) &&
    disconnectRevoke.attemptId === input.attemptId &&
    disconnectRevoke.cleanupDeadlineAtMs === input.cleanupDeadlineAt.getTime() &&
    input.cleanupDeadlineAt > input.now &&
    input.cleanupDeadlineAt.getTime() - input.now.getTime() <=
      GOOGLE_DISCONNECT_REVOKE_WINDOW_MS
  )
}

function connectionMatchesFrozenVersions(
  connection: ConnectionRow,
  versions: FrozenVersions,
): boolean {
  return (
    connection.status === 'active' &&
    connection.credentialUseState === 'active' &&
    connection.lifecycleVersion === versions.lifecycleVersion &&
    connection.accessVersion === versions.accessVersion &&
    connection.credentialGeneration === versions.credentialGeneration
  )
}

function attemptMatchesPrepare(
  attempt: AttemptRow,
  input: PrepareInput,
  versions: FrozenVersions,
): boolean {
  return (
    exactScope(attempt, {
      organizationId: input.authorization.organizationId,
      connectionId: input.authorization.connectionId,
      initiatorUserId: input.authorization.initiatorUserId,
    }) &&
    attempt.state === 'active' &&
    attempt.expectedLifecycleVersion === versions.lifecycleVersion &&
    attempt.expectedAccessVersion === versions.accessVersion &&
    attempt.expectedCredentialGeneration === versions.credentialGeneration &&
    attempt.credentialBinding === input.credentialBinding &&
    attempt.cleanupDeadlineAt.getTime() === input.cleanupDeadlineAt.getTime()
  )
}

function isWellFormedDispatchRequest(input: AcquireDispatchInput): boolean {
  const disconnectRevoke = input.authorization.disconnectRevoke
  return (
    UUID.test(input.cleanupWorkPermitId) &&
    SHA256.test(input.credentialBinding) &&
    Boolean(disconnectRevoke) &&
    disconnectRevoke.attemptId === input.attemptId
  )
}

function attemptIsDispatchable(
  attempt: AttemptRow,
  input: AcquireDispatchInput,
  versions: FrozenVersions,
): boolean {
  return (
    attempt.state === 'active' &&
    attempt.credentialBinding === input.credentialBinding &&
    attempt.expectedLifecycleVersion === versions.lifecycleVersion &&
    attempt.expectedAccessVersion === versions.accessVersion &&
    attempt.expectedCredentialGeneration === versions.credentialGeneration
  )
}

function permitBindsCleanupWork(
  permit: PermitRow | undefined,
  attempt: AttemptRow,
  credentialBinding: string,
  versions: FrozenVersions,
): boolean {
  return (
    permit !== undefined &&
    permit.state === 'admitted' &&
    permit.capability === 'property.import_gbp_v2' &&
    permit.operationKey === 'provider.oauth.revoke' &&
    permit.routeKey === 'oauth.revoke' &&
    permit.organizationId === attempt.organizationId &&
    permit.connectionId === attempt.connectionId &&
    permit.initiatorUserId === attempt.initiatorUserId &&
    permit.authorizationVector.credentialBinding === credentialBinding &&
    permit.authorizationVector.connectionLifecycleVersion === versions.lifecycleVersion &&
    permit.authorizationVector.connectionAccessVersion === versions.accessVersion &&
    permit.authorizationVector.credentialGeneration === versions.credentialGeneration
  )
}

async function redactConnection(
  tx: Tx,
  attempt: AttemptRow,
  outcome: GoogleDisconnectRevokeOutcome,
  now: Date,
) {
  const expectedLifecycle =
    attempt.state === 'dispatching'
      ? attempt.expectedLifecycleVersion + 1
      : attempt.expectedLifecycleVersion
  const [connection] = await tx
    .update(googleConnections)
    .set({
      status: 'disconnected',
      credentialUseState: 'none',
      cleanupMaterialDeadlineAt: null,
      encryptedAccessToken: 'redacted',
      encryptedRefreshToken: 'redacted',
      googleSubject: null,
      scopes: [],
      lifecycleVersion: attempt.expectedLifecycleVersion + 1,
      accessVersion: attempt.expectedAccessVersion + 1,
      credentialGeneration: attempt.expectedCredentialGeneration + 1,
      statusReason: `disconnect_${outcome}`,
      statusChangedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(googleConnections.organizationId, attempt.organizationId),
        eq(googleConnections.id, attempt.connectionId),
        eq(googleConnections.lifecycleVersion, expectedLifecycle),
        eq(googleConnections.accessVersion, attempt.expectedAccessVersion),
        eq(googleConnections.credentialGeneration, attempt.expectedCredentialGeneration),
        eq(
          googleConnections.status,
          attempt.state === 'dispatching' ? 'disconnecting' : 'active',
        ),
        eq(
          googleConnections.credentialUseState,
          attempt.state === 'dispatching' ? 'cleanup_only' : 'active',
        ),
      ),
    )
    .returning()
  return connection ?? null
}

export const createGoogleDisconnectRevokeRepository = (
  db: Database,
): GoogleDisconnectRevokeStore => {
  const settle = async (
    input: Parameters<GoogleDisconnectRevokeStore['settle']>[0],
  ): Promise<GoogleDisconnectRevokeResult<GoogleConnection>> => {
    if (!OUTCOME_CODE.test(input.outcomeCode)) return fail('invalid_transition')
    return db.transaction(
      async (tx): Promise<GoogleDisconnectRevokeResult<GoogleConnection>> => {
        const attempt = await readAttemptForUpdate(tx, input.attemptId)
        if (!attempt) return fail('not_found')
        if (!exactScope(attempt, input)) return fail('scope_mismatch')
        if (
          attempt.state === 'confirmed_not_sent' ||
          attempt.state === 'confirmed_revoked' ||
          attempt.state === 'cleanup_ambiguous'
        ) {
          if (attempt.state !== input.outcome) return fail('invalid_transition')
          const [connection] = await tx
            .select()
            .from(googleConnections)
            .where(
              and(
                eq(googleConnections.organizationId, input.organizationId),
                eq(googleConnections.id, input.connectionId),
                eq(googleConnections.status, 'disconnected'),
                eq(googleConnections.credentialUseState, 'none'),
              ),
            )
            .limit(1)
          return connection
            ? success(googleConnectionFromRow(connection))
            : fail('invalid_transition')
        }
        if (
          (attempt.state !== 'active' && attempt.state !== 'dispatching') ||
          (attempt.state === 'active' && input.outcome !== 'confirmed_not_sent')
        ) {
          return fail('invalid_transition')
        }
        const connection = await redactConnection(tx, attempt, input.outcome, input.now)
        if (!connection) return fail('invalid_transition')
        const updated = await updateAttempt(tx, {
          ...attempt,
          state: input.outcome,
          credentialBinding: null,
          terminalAt: input.now,
          outcomeCode: input.outcomeCode,
          updatedAt: input.now,
        })
        if (!updated) return fail('invalid_transition')
        await insertOutboxRow(tx, input.event)
        return success(googleConnectionFromRow(connection))
      },
    )
  }

  return Object.freeze({
    prepare: (input) =>
      db.transaction(async (tx) => {
        const versions = frozenVersions(input.authorization)
        if (!versions || !isWellFormedPrepareRequest(input)) {
          return fail('invalid_transition')
        }
        const [connection] = await tx
          .select()
          .from(googleConnections)
          .where(
            and(
              eq(googleConnections.organizationId, input.authorization.organizationId),
              eq(googleConnections.id, input.authorization.connectionId),
            ),
          )
          .for('update')
          .limit(1)
        if (!connection) return fail('not_found')
        if (!connectionMatchesFrozenVersions(connection, versions)) {
          return fail('scope_mismatch')
        }
        const [concurrent] = await tx
          .select({ key: idempotencyReceipts.key })
          .from(idempotencyReceipts)
          .where(
            and(
              eq(idempotencyReceipts.scope, RECEIPT_SCOPE),
              not(eq(idempotencyReceipts.key, input.attemptId)),
              sql`${idempotencyReceipts.payload}->>'organizationId' = ${input.authorization.organizationId}`,
              sql`${idempotencyReceipts.payload}->>'connectionId' = ${input.authorization.connectionId}`,
              sql`${idempotencyReceipts.payload}->>'state' IN ('active', 'dispatching')`,
            ),
          )
          .limit(1)
        if (concurrent) return fail('concurrent_attempt')
        const attempt: AttemptRow = {
          id: input.attemptId,
          organizationId: input.authorization.organizationId,
          connectionId: input.authorization.connectionId,
          initiatorUserId: input.authorization.initiatorUserId,
          cleanupWorkPermitId: null,
          state: 'active',
          expectedLifecycleVersion: versions.lifecycleVersion,
          expectedAccessVersion: versions.accessVersion,
          expectedCredentialGeneration: versions.credentialGeneration,
          credentialBinding: input.credentialBinding,
          cleanupDeadlineAt: input.cleanupDeadlineAt,
          activatedAt: input.now,
          dispatchingAt: null,
          terminalAt: null,
          outcomeCode: null,
          createdAt: input.now,
          updatedAt: input.now,
        }
        await tx
          .insert(idempotencyReceipts)
          .values({
            scope: RECEIPT_SCOPE,
            key: input.attemptId,
            payload: attemptPayload(attempt),
            recordedAt: input.now,
          })
          .onConflictDoNothing()
        const persisted = await readAttemptForUpdate(tx, input.attemptId)
        if (!persisted) return fail('concurrent_attempt')
        return attemptMatchesPrepare(persisted, input, versions)
          ? success({ prepared: true as const })
          : fail('concurrent_attempt')
      }),

    acquireDispatch: (input) =>
      db.transaction(async (tx) => {
        const versions = frozenVersions(input.authorization)
        if (!versions || !isWellFormedDispatchRequest(input)) {
          return fail('invalid_transition')
        }
        const attempt = await readAttemptForUpdate(tx, input.attemptId)
        if (!attempt) return fail('not_found')
        if (
          !exactScope(attempt, {
            organizationId: input.authorization.organizationId,
            connectionId: input.authorization.connectionId,
            initiatorUserId: input.authorization.initiatorUserId,
          })
        ) {
          return fail('scope_mismatch')
        }
        if (attempt.cleanupDeadlineAt <= input.now) return fail('deadline_exceeded')
        if (!attemptIsDispatchable(attempt, input, versions)) {
          return fail('invalid_transition')
        }
        const [permit] = await tx
          .select()
          .from(authorizationExecutionPermits)
          .where(eq(authorizationExecutionPermits.id, input.cleanupWorkPermitId))
          .for('update')
          .limit(1)
        if (!permitBindsCleanupWork(permit, attempt, input.credentialBinding, versions)) {
          return fail('scope_mismatch')
        }
        const [permitConflict] = await tx
          .select({ key: idempotencyReceipts.key })
          .from(idempotencyReceipts)
          .where(
            and(
              eq(idempotencyReceipts.scope, RECEIPT_SCOPE),
              not(eq(idempotencyReceipts.key, attempt.id)),
              sql`${idempotencyReceipts.payload}->>'cleanupWorkPermitId' = ${input.cleanupWorkPermitId}`,
            ),
          )
          .limit(1)
        if (permitConflict) return fail('scope_mismatch')
        const connections = await tx
          .update(googleConnections)
          .set({
            status: 'disconnecting',
            credentialUseState: 'cleanup_only',
            cleanupMaterialDeadlineAt: attempt.cleanupDeadlineAt,
            lifecycleVersion: attempt.expectedLifecycleVersion + 1,
            statusReason: 'disconnect_cleanup_dispatching',
            statusChangedAt: input.now,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(googleConnections.organizationId, attempt.organizationId),
              eq(googleConnections.id, attempt.connectionId),
              eq(googleConnections.status, 'active'),
              eq(googleConnections.credentialUseState, 'active'),
              eq(googleConnections.lifecycleVersion, attempt.expectedLifecycleVersion),
              eq(googleConnections.accessVersion, attempt.expectedAccessVersion),
              eq(
                googleConnections.credentialGeneration,
                attempt.expectedCredentialGeneration,
              ),
            ),
          )
          .returning({ id: googleConnections.id })
        if (!connections[0]) return fail('scope_mismatch')
        await updateAttempt(tx, {
          ...attempt,
          state: 'dispatching',
          cleanupWorkPermitId: input.cleanupWorkPermitId,
          credentialBinding: null,
          dispatchingAt: input.now,
          updatedAt: input.now,
        })
        return success({ dispatching: true as const })
      }),

    settle,

    reconcileElapsed: async (input) => {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        return { visited: 0, confirmedNotSent: 0, cleanupAmbiguous: 0 }
      }
      return db.transaction(async (tx) => {
        const receipts = await tx
          .select({ payload: idempotencyReceipts.payload })
          .from(idempotencyReceipts)
          .where(
            and(
              eq(idempotencyReceipts.scope, RECEIPT_SCOPE),
              sql`${idempotencyReceipts.payload}->>'state' IN ('active', 'dispatching')`,
              sql`(${idempotencyReceipts.payload}->>'cleanupDeadlineAt')::timestamptz <= ${input.now}`,
            ),
          )
          .orderBy(
            asc(sql`(${idempotencyReceipts.payload}->>'cleanupDeadlineAt')::timestamptz`),
          )
          .limit(input.limit)
          .for('update', { skipLocked: true })
        const attempts = receipts.map(({ payload }) => attemptFromPayload(payload))
        let confirmedNotSent = 0
        let cleanupAmbiguous = 0
        for (const attempt of attempts) {
          let outcome: GoogleDisconnectRevokeOutcome = 'confirmed_not_sent'
          if (attempt.state === 'dispatching' && attempt.cleanupWorkPermitId) {
            const [permit] = await tx
              .select({
                state: authorizationExecutionPermits.state,
                startedAt: authorizationExecutionPermits.startedAt,
              })
              .from(authorizationExecutionPermits)
              .where(eq(authorizationExecutionPermits.id, attempt.cleanupWorkPermitId))
              .limit(1)
            if (
              !permit ||
              permit.startedAt !== null ||
              permit.state === 'started' ||
              permit.state === 'completed'
            ) {
              outcome = 'cleanup_ambiguous'
            }
          }
          const connection = await redactConnection(tx, attempt, outcome, input.now)
          if (!connection) continue
          const event = integrationGoogleAccountDisconnected({
            connectionId: googleConnectionId(attempt.connectionId),
            organizationId: organizationId(attempt.organizationId),
            occurredAt: input.now,
          })
          await updateAttempt(tx, {
            ...attempt,
            state: outcome,
            credentialBinding: null,
            terminalAt: input.now,
            outcomeCode:
              outcome === 'confirmed_not_sent'
                ? 'reconciled_permit_not_started'
                : 'reconciled_provider_state_ambiguous',
            updatedAt: input.now,
          })
          await insertOutboxRow(tx, event)
          if (outcome === 'confirmed_not_sent') confirmedNotSent += 1
          else cleanupAmbiguous += 1
        }
        return {
          visited: attempts.length,
          confirmedNotSent,
          cleanupAmbiguous,
        }
      })
    },
  })
}
