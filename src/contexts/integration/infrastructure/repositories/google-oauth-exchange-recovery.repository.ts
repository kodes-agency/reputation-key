import { and, asc, eq, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { idempotencyReceipts } from '#/shared/db/schema/outbox.schema'
import type { Tx } from '#/shared/outbox/commit'
import type {
  GoogleOAuthExchangeAttemptFacts,
  GoogleOAuthExchangeAttemptState,
  GoogleOAuthExchangeRecoveryResult,
  GoogleOAuthExchangeRecoveryStore,
} from '../../application/google-oauth-exchange-recovery'
import {
  GOOGLE_OAUTH_EXCHANGE_APPLY_LEASE_MS,
  GOOGLE_OAUTH_EXCHANGE_RESPONSE_TTL_MS,
} from '../../application/google-oauth-exchange-recovery'

const RECEIPT_SCOPE = 'google_oauth_exchange'
const OUTCOME_CODE = /^[a-z0-9_.-]{1,100}$/u
const MAX_ENCRYPTED_RESULT_BYTES = 128 * 1024
const ATTEMPT_STATES: Readonly<Record<GoogleOAuthExchangeAttemptState, true>> = {
  prepared: true,
  provider_started: true,
  response_preserved: true,
  applying: true,
  completed: true,
  failed: true,
  provider_outcome_ambiguous: true,
  expired: true,
}

type AttemptRow = GoogleOAuthExchangeAttemptFacts &
  Readonly<{
    state: GoogleOAuthExchangeAttemptState
    encryptedResult: string | null
    providerStartedAt: Date | null
    preservedAt: Date | null
    responseExpiresAt: Date | null
    applyLeaseExpiresAt: Date | null
    terminalAt: Date | null
    outcomeCode: string | null
    createdAt: Date
    updatedAt: Date
  }>

type AttemptPayload = Readonly<{
  id: string
  organizationId: string
  initiatorUserId: string
  connectionId: string
  connectionMode: 'new' | 'reauth' | 'reconnect'
  targetConnectionId: string | null
  state: GoogleOAuthExchangeAttemptState
  expectedLifecycleVersion: number
  expectedAccessVersion: number
  expectedCredentialGeneration: number
  encryptedResult: string | null
  providerStartedAt: string | null
  preservedAt: string | null
  responseExpiresAt: string | null
  applyLeaseExpiresAt: string | null
  terminalAt: string | null
  outcomeCode: string | null
  createdAt: string
  updatedAt: string
}>

const fail = <T>(
  code: Exclude<GoogleOAuthExchangeRecoveryResult<T>, { ok: true }>['code'],
): GoogleOAuthExchangeRecoveryResult<T> => ({ ok: false, code })
const success = <T>(value: T): GoogleOAuthExchangeRecoveryResult<T> => ({
  ok: true,
  value,
})

function requiredString(
  payload: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const value = payload[field]
  if (typeof value !== 'string') throw new Error('google_oauth_exchange_receipt_invalid')
  return value
}

function nullableString(
  payload: Readonly<Record<string, unknown>>,
  field: string,
): string | null {
  const value = payload[field]
  if (value === null) return null
  if (typeof value !== 'string') throw new Error('google_oauth_exchange_receipt_invalid')
  return value
}

function requiredInteger(
  payload: Readonly<Record<string, unknown>>,
  field: string,
): number {
  const value = payload[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('google_oauth_exchange_receipt_invalid')
  }
  return value
}

function requiredDate(payload: Readonly<Record<string, unknown>>, field: string): Date {
  const value = requiredString(payload, field)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()))
    throw new Error('google_oauth_exchange_receipt_invalid')
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
    throw new Error('google_oauth_exchange_receipt_invalid')
  return parsed
}

function attemptFromPayload(payload: Readonly<Record<string, unknown>>): AttemptRow {
  const connectionMode = requiredString(payload, 'connectionMode')
  const state = requiredString(payload, 'state')
  if (
    (connectionMode !== 'new' &&
      connectionMode !== 'reauth' &&
      connectionMode !== 'reconnect') ||
    !(state in ATTEMPT_STATES)
  ) {
    throw new Error('google_oauth_exchange_receipt_invalid')
  }
  return {
    id: requiredString(payload, 'id'),
    organizationId: requiredString(payload, 'organizationId'),
    initiatorUserId: requiredString(payload, 'initiatorUserId'),
    connectionId: requiredString(payload, 'connectionId'),
    connectionMode,
    targetConnectionId: nullableString(payload, 'targetConnectionId'),
    state: state as GoogleOAuthExchangeAttemptState,
    expectedLifecycleVersion: requiredInteger(payload, 'expectedLifecycleVersion'),
    expectedAccessVersion: requiredInteger(payload, 'expectedAccessVersion'),
    expectedCredentialGeneration: requiredInteger(
      payload,
      'expectedCredentialGeneration',
    ),
    encryptedResult: nullableString(payload, 'encryptedResult'),
    providerStartedAt: nullableDate(payload, 'providerStartedAt'),
    preservedAt: nullableDate(payload, 'preservedAt'),
    responseExpiresAt: nullableDate(payload, 'responseExpiresAt'),
    applyLeaseExpiresAt: nullableDate(payload, 'applyLeaseExpiresAt'),
    terminalAt: nullableDate(payload, 'terminalAt'),
    outcomeCode: nullableString(payload, 'outcomeCode'),
    createdAt: requiredDate(payload, 'createdAt'),
    updatedAt: requiredDate(payload, 'updatedAt'),
  }
}

const attemptPayload = (attempt: AttemptRow): AttemptPayload => ({
  ...attempt,
  providerStartedAt: attempt.providerStartedAt?.toISOString() ?? null,
  preservedAt: attempt.preservedAt?.toISOString() ?? null,
  responseExpiresAt: attempt.responseExpiresAt?.toISOString() ?? null,
  applyLeaseExpiresAt: attempt.applyLeaseExpiresAt?.toISOString() ?? null,
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

async function updateAttempt(tx: Tx, attempt: AttemptRow): Promise<void> {
  await tx
    .update(idempotencyReceipts)
    .set({ payload: attemptPayload(attempt) })
    .where(
      and(
        eq(idempotencyReceipts.scope, RECEIPT_SCOPE),
        eq(idempotencyReceipts.key, attempt.id),
      ),
    )
}

function sameFacts(row: AttemptRow, input: GoogleOAuthExchangeAttemptFacts): boolean {
  return (
    row.organizationId === input.organizationId &&
    row.initiatorUserId === input.initiatorUserId &&
    row.connectionId === input.connectionId &&
    row.connectionMode === input.connectionMode &&
    row.targetConnectionId === input.targetConnectionId &&
    row.expectedLifecycleVersion === input.expectedLifecycleVersion &&
    row.expectedAccessVersion === input.expectedAccessVersion &&
    row.expectedCredentialGeneration === input.expectedCredentialGeneration
  )
}

function scopeMatches(
  row: AttemptRow,
  input: Readonly<{ organizationId: string; initiatorUserId: string }>,
): boolean {
  return (
    row.organizationId === input.organizationId &&
    row.initiatorUserId === input.initiatorUserId
  )
}

export const createGoogleOAuthExchangeRecoveryRepository = (
  db: Database,
): GoogleOAuthExchangeRecoveryStore => {
  return Object.freeze({
    begin: (input) =>
      db.transaction(async (tx) => {
        const attempt: AttemptRow = {
          id: input.id,
          organizationId: input.organizationId,
          initiatorUserId: input.initiatorUserId,
          connectionId: input.connectionId,
          connectionMode: input.connectionMode,
          targetConnectionId: input.targetConnectionId,
          state: 'prepared',
          expectedLifecycleVersion: input.expectedLifecycleVersion,
          expectedAccessVersion: input.expectedAccessVersion,
          expectedCredentialGeneration: input.expectedCredentialGeneration,
          encryptedResult: null,
          providerStartedAt: null,
          preservedAt: null,
          responseExpiresAt: null,
          applyLeaseExpiresAt: null,
          terminalAt: null,
          outcomeCode: null,
          createdAt: input.now,
          updatedAt: input.now,
        }
        await tx
          .insert(idempotencyReceipts)
          .values({
            scope: RECEIPT_SCOPE,
            key: input.id,
            payload: attemptPayload(attempt),
            recordedAt: input.now,
          })
          .onConflictDoNothing()
        const row = await readAttemptForUpdate(tx, input.id)
        if (!row) return fail('not_found')
        if (!sameFacts(row, input)) return fail('scope_mismatch')
        return row.state === 'prepared'
          ? success({ state: 'prepared' as const })
          : fail('invalid_transition')
      }),

    markProviderStarted: (input) =>
      db.transaction(async (tx) => {
        const row = await readAttemptForUpdate(tx, input.id)
        if (!row) return fail('not_found')
        if (!scopeMatches(row, input)) return fail('scope_mismatch')
        if (row.state !== 'prepared') {
          return row.state === 'provider_started' || row.state === 'response_preserved'
            ? fail('already_started')
            : fail('invalid_transition')
        }
        await updateAttempt(tx, {
          ...row,
          state: 'provider_started',
          providerStartedAt: input.now,
          updatedAt: input.now,
        })
        return success({ started: true as const })
      }),

    preserveSuccessfulResult: (input) =>
      db.transaction(async (tx) => {
        if (
          typeof input.encryptedResult !== 'string' ||
          input.encryptedResult.length === 0 ||
          Buffer.byteLength(input.encryptedResult, 'utf8') > MAX_ENCRYPTED_RESULT_BYTES
        ) {
          return fail('invalid_transition')
        }
        const row = await readAttemptForUpdate(tx, input.id)
        if (!row) return fail('not_found')
        if (!scopeMatches(row, input)) return fail('scope_mismatch')
        if (row.state !== 'provider_started') return fail('invalid_transition')
        await updateAttempt(tx, {
          ...row,
          state: 'response_preserved',
          encryptedResult: input.encryptedResult,
          preservedAt: input.now,
          responseExpiresAt: new Date(
            input.now.getTime() + GOOGLE_OAUTH_EXCHANGE_RESPONSE_TTL_MS,
          ),
          updatedAt: input.now,
        })
        return success({ preserved: true as const })
      }),

    claimPreservedResult: (input) =>
      db.transaction(async (tx) => {
        const row = await readAttemptForUpdate(tx, input.id)
        if (!row) return fail('not_found')
        if (!scopeMatches(row, input)) return fail('scope_mismatch')
        if (row.state === 'completed') return fail('completed')
        if (
          row.state === 'provider_started' ||
          row.state === 'provider_outcome_ambiguous'
        ) {
          return fail('outcome_ambiguous')
        }
        if (row.state === 'expired' || row.state === 'failed') return fail('expired')
        if (
          !row.encryptedResult ||
          !row.responseExpiresAt ||
          row.responseExpiresAt <= input.now
        ) {
          if (row.state === 'response_preserved' || row.state === 'applying') {
            await updateAttempt(tx, {
              ...row,
              state: 'expired',
              encryptedResult: null,
              responseExpiresAt: null,
              applyLeaseExpiresAt: null,
              terminalAt: input.now,
              outcomeCode: 'response_expired',
              updatedAt: input.now,
            })
          }
          return fail('expired')
        }
        if (
          row.state === 'applying' &&
          row.applyLeaseExpiresAt &&
          row.applyLeaseExpiresAt > input.now
        ) {
          return fail('in_progress')
        }
        if (row.state !== 'response_preserved' && row.state !== 'applying') {
          return fail('invalid_transition')
        }
        const leaseExpiresAt = new Date(
          Math.min(
            row.responseExpiresAt.getTime(),
            input.now.getTime() + GOOGLE_OAUTH_EXCHANGE_APPLY_LEASE_MS,
          ),
        )
        await updateAttempt(tx, {
          ...row,
          state: 'applying',
          applyLeaseExpiresAt: leaseExpiresAt,
          updatedAt: input.now,
        })
        return success({
          id: row.id,
          organizationId: row.organizationId,
          initiatorUserId: row.initiatorUserId,
          connectionId: row.connectionId,
          connectionMode: row.connectionMode,
          targetConnectionId: row.targetConnectionId,
          expectedLifecycleVersion: row.expectedLifecycleVersion,
          expectedAccessVersion: row.expectedAccessVersion,
          expectedCredentialGeneration: row.expectedCredentialGeneration,
          encryptedResult: row.encryptedResult,
        })
      }),

    loadCompletedAttempt: async (input) => {
      const [receipt] = await db
        .select({ payload: idempotencyReceipts.payload })
        .from(idempotencyReceipts)
        .where(
          and(
            eq(idempotencyReceipts.scope, RECEIPT_SCOPE),
            eq(idempotencyReceipts.key, input.id),
          ),
        )
        .limit(1)
      if (!receipt) return null
      const row = attemptFromPayload(receipt.payload)
      return row.state === 'completed' && scopeMatches(row, input)
        ? {
            id: row.id,
            organizationId: row.organizationId,
            initiatorUserId: row.initiatorUserId,
            connectionId: row.connectionId,
            connectionMode: row.connectionMode,
            targetConnectionId: row.targetConnectionId,
            expectedLifecycleVersion: row.expectedLifecycleVersion,
            expectedAccessVersion: row.expectedAccessVersion,
            expectedCredentialGeneration: row.expectedCredentialGeneration,
          }
        : null
    },

    releaseClaim: (input) =>
      db.transaction(async (tx) => {
        if (!OUTCOME_CODE.test(input.outcomeCode)) return fail('invalid_transition')
        const row = await readAttemptForUpdate(tx, input.id)
        if (!row) return fail('not_found')
        if (!scopeMatches(row, input)) return fail('scope_mismatch')
        if (
          row.state !== 'applying' ||
          !row.encryptedResult ||
          !row.responseExpiresAt ||
          row.responseExpiresAt <= input.now
        ) {
          return fail('invalid_transition')
        }
        await updateAttempt(tx, {
          ...row,
          state: 'response_preserved',
          applyLeaseExpiresAt: null,
          outcomeCode: input.outcomeCode,
          updatedAt: input.now,
        })
        return success({ released: true as const })
      }),

    discardClaim: (input) =>
      db.transaction(async (tx) => {
        if (!OUTCOME_CODE.test(input.outcomeCode)) return fail('invalid_transition')
        const row = await readAttemptForUpdate(tx, input.id)
        if (!row) return fail('not_found')
        if (!scopeMatches(row, input)) return fail('scope_mismatch')
        if (row.state !== 'applying') return fail('invalid_transition')
        await updateAttempt(tx, {
          ...row,
          state: 'failed',
          encryptedResult: null,
          responseExpiresAt: null,
          applyLeaseExpiresAt: null,
          terminalAt: input.now,
          outcomeCode: input.outcomeCode,
          updatedAt: input.now,
        })
        return success({ discarded: true as const })
      }),

    finishWithoutResult: (input) =>
      db.transaction(async (tx) => {
        if (!OUTCOME_CODE.test(input.outcomeCode)) return fail('invalid_transition')
        const row = await readAttemptForUpdate(tx, input.id)
        if (!row) return fail('not_found')
        if (!scopeMatches(row, input)) return fail('scope_mismatch')
        if (row.state !== 'prepared' && row.state !== 'provider_started') {
          return fail('invalid_transition')
        }
        await updateAttempt(tx, {
          ...row,
          state: input.outcome,
          encryptedResult: null,
          responseExpiresAt: null,
          applyLeaseExpiresAt: null,
          terminalAt: input.now,
          outcomeCode: input.outcomeCode,
          updatedAt: input.now,
        })
        return success({ finished: true as const })
      }),

    expire: async (input) => {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        return { expired: 0 }
      }
      return db.transaction(async (tx) => {
        const rows = await tx
          .select({ payload: idempotencyReceipts.payload })
          .from(idempotencyReceipts)
          .where(
            and(
              eq(idempotencyReceipts.scope, RECEIPT_SCOPE),
              or(
                sql`(${idempotencyReceipts.payload}->>'state') IN ('response_preserved', 'applying')
                  AND (${idempotencyReceipts.payload}->>'responseExpiresAt')::timestamptz <= ${input.now}`,
                sql`(${idempotencyReceipts.payload}->>'state') IN ('prepared', 'provider_started')
                  AND ${idempotencyReceipts.recordedAt} <= ${new Date(input.now.getTime() - GOOGLE_OAUTH_EXCHANGE_RESPONSE_TTL_MS)}`,
              ),
            ),
          )
          .orderBy(asc(idempotencyReceipts.recordedAt))
          .limit(input.limit)
          .for('update', { skipLocked: true })
        for (const receipt of rows) {
          const row = attemptFromPayload(receipt.payload)
          const ambiguous = row.state === 'provider_started'
          await updateAttempt(tx, {
            ...row,
            state: ambiguous ? 'provider_outcome_ambiguous' : 'expired',
            encryptedResult: null,
            responseExpiresAt: null,
            applyLeaseExpiresAt: null,
            terminalAt: input.now,
            outcomeCode: ambiguous ? 'provider_result_not_preserved' : 'attempt_expired',
            updatedAt: input.now,
          })
        }
        return { expired: rows.length }
      })
    },
  })
}
