import { and, asc, eq, inArray, lte, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { googleOauthExchangeAttempts } from '#/shared/db/schema'
import type {
  GoogleOAuthExchangeAttemptFacts,
  GoogleOAuthExchangeRecoveryResult,
  GoogleOAuthExchangeRecoveryStore,
} from '../../application/google-oauth-exchange-recovery'
import {
  GOOGLE_OAUTH_EXCHANGE_APPLY_LEASE_MS,
  GOOGLE_OAUTH_EXCHANGE_RESPONSE_TTL_MS,
} from '../../application/google-oauth-exchange-recovery'

const OUTCOME_CODE = /^[a-z0-9_.-]{1,100}$/u
const MAX_ENCRYPTED_RESULT_BYTES = 128 * 1024

const fail = <T>(
  code: Exclude<GoogleOAuthExchangeRecoveryResult<T>, { ok: true }>['code'],
): GoogleOAuthExchangeRecoveryResult<T> => ({ ok: false, code })
const success = <T>(value: T): GoogleOAuthExchangeRecoveryResult<T> => ({
  ok: true,
  value,
})

function sameFacts(
  row: typeof googleOauthExchangeAttempts.$inferSelect,
  input: GoogleOAuthExchangeAttemptFacts,
): boolean {
  return (
    row.organizationId === input.organizationId &&
    row.initiatorUserId === input.initiatorUserId &&
    row.connectionId === input.connectionId &&
    row.connectionMode === input.connectionMode &&
    row.targetConnectionId === input.targetConnectionId &&
    row.expectedLifecycleVersion === input.expectedLifecycleVersion &&
    row.expectedAccessVersion === input.expectedAccessVersion &&
    row.expectedCredentialGeneration === input.expectedCredentialGeneration &&
    row.credentialHomeCellId === input.credentialHome.homeCellId &&
    row.credentialHomePolicyVersion === input.credentialHome.cataloguePolicyVersion &&
    row.credentialHomeAuthorityGeneration === input.credentialHome.authorityGeneration
  )
}

function scopeMatches(
  row: typeof googleOauthExchangeAttempts.$inferSelect,
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
        await tx
          .insert(googleOauthExchangeAttempts)
          .values({
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
            credentialHomeCellId: input.credentialHome.homeCellId,
            credentialHomePolicyVersion: input.credentialHome.cataloguePolicyVersion,
            credentialHomeAuthorityGeneration: input.credentialHome.authorityGeneration,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing({ target: googleOauthExchangeAttempts.id })
        const [row] = await tx
          .select()
          .from(googleOauthExchangeAttempts)
          .where(eq(googleOauthExchangeAttempts.id, input.id))
          .for('update')
          .limit(1)
        if (!row) return fail('not_found')
        if (!sameFacts(row, input)) return fail('scope_mismatch')
        return row.state === 'prepared'
          ? success({ state: 'prepared' as const })
          : fail('invalid_transition')
      }),

    markProviderStarted: (input) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(googleOauthExchangeAttempts)
          .where(eq(googleOauthExchangeAttempts.id, input.id))
          .for('update')
          .limit(1)
        if (!row) return fail('not_found')
        if (!scopeMatches(row, input)) return fail('scope_mismatch')
        if (row.state !== 'prepared') {
          return row.state === 'provider_started' || row.state === 'response_preserved'
            ? fail('already_started')
            : fail('invalid_transition')
        }
        await tx
          .update(googleOauthExchangeAttempts)
          .set({
            state: 'provider_started',
            providerStartedAt: input.now,
            updatedAt: input.now,
          })
          .where(eq(googleOauthExchangeAttempts.id, row.id))
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
        const [row] = await tx
          .select()
          .from(googleOauthExchangeAttempts)
          .where(eq(googleOauthExchangeAttempts.id, input.id))
          .for('update')
          .limit(1)
        if (!row) return fail('not_found')
        if (!scopeMatches(row, input)) return fail('scope_mismatch')
        if (row.state !== 'provider_started') return fail('invalid_transition')
        await tx
          .update(googleOauthExchangeAttempts)
          .set({
            state: 'response_preserved',
            encryptedResult: input.encryptedResult,
            preservedAt: input.now,
            responseExpiresAt: new Date(
              input.now.getTime() + GOOGLE_OAUTH_EXCHANGE_RESPONSE_TTL_MS,
            ),
            updatedAt: input.now,
          })
          .where(eq(googleOauthExchangeAttempts.id, row.id))
        return success({ preserved: true as const })
      }),

    claimPreservedResult: (input) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(googleOauthExchangeAttempts)
          .where(eq(googleOauthExchangeAttempts.id, input.id))
          .for('update')
          .limit(1)
        if (!row) return fail('not_found')
        if (!scopeMatches(row, input)) return fail('scope_mismatch')
        if (row.state === 'completed') return fail('completed')
        if (row.state === 'provider_started') return fail('outcome_ambiguous')
        if (row.state === 'provider_outcome_ambiguous') {
          return fail('outcome_ambiguous')
        }
        if (row.state === 'expired' || row.state === 'failed') return fail('expired')
        if (
          !row.encryptedResult ||
          !row.responseExpiresAt ||
          row.responseExpiresAt <= input.now
        ) {
          if (row.state === 'response_preserved' || row.state === 'applying') {
            await tx
              .update(googleOauthExchangeAttempts)
              .set({
                state: 'expired',
                encryptedResult: null,
                responseExpiresAt: null,
                applyLeaseExpiresAt: null,
                terminalAt: input.now,
                outcomeCode: 'response_expired',
                updatedAt: input.now,
              })
              .where(eq(googleOauthExchangeAttempts.id, row.id))
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
        await tx
          .update(googleOauthExchangeAttempts)
          .set({
            state: 'applying',
            applyLeaseExpiresAt: leaseExpiresAt,
            updatedAt: input.now,
          })
          .where(eq(googleOauthExchangeAttempts.id, row.id))
        return success({
          id: row.id,
          organizationId: row.organizationId,
          initiatorUserId: row.initiatorUserId,
          connectionId: row.connectionId,
          connectionMode: row.connectionMode as 'new' | 'reauth' | 'reconnect',
          targetConnectionId: row.targetConnectionId,
          expectedLifecycleVersion: row.expectedLifecycleVersion,
          expectedAccessVersion: row.expectedAccessVersion,
          expectedCredentialGeneration: row.expectedCredentialGeneration,
          credentialHome: {
            homeCellId: row.credentialHomeCellId as 'us' | 'europe' | 'global',
            cataloguePolicyVersion: row.credentialHomePolicyVersion,
            authorityGeneration: row.credentialHomeAuthorityGeneration,
          },
          encryptedResult: row.encryptedResult,
        })
      }),

    loadCompletedAttempt: async (input) => {
      const [row] = await db
        .select()
        .from(googleOauthExchangeAttempts)
        .where(
          and(
            eq(googleOauthExchangeAttempts.id, input.id),
            eq(googleOauthExchangeAttempts.organizationId, input.organizationId),
            eq(googleOauthExchangeAttempts.initiatorUserId, input.initiatorUserId),
            eq(googleOauthExchangeAttempts.state, 'completed'),
          ),
        )
        .limit(1)
      return row
        ? {
            id: row.id,
            organizationId: row.organizationId,
            initiatorUserId: row.initiatorUserId,
            connectionId: row.connectionId,
            connectionMode: row.connectionMode as 'new' | 'reauth' | 'reconnect',
            targetConnectionId: row.targetConnectionId,
            expectedLifecycleVersion: row.expectedLifecycleVersion,
            expectedAccessVersion: row.expectedAccessVersion,
            expectedCredentialGeneration: row.expectedCredentialGeneration,
            credentialHome: {
              homeCellId: row.credentialHomeCellId as 'us' | 'europe' | 'global',
              cataloguePolicyVersion: row.credentialHomePolicyVersion,
              authorityGeneration: row.credentialHomeAuthorityGeneration,
            },
          }
        : null
    },

    releaseClaim: (input) =>
      db.transaction(async (tx) => {
        if (!OUTCOME_CODE.test(input.outcomeCode)) return fail('invalid_transition')
        const [row] = await tx
          .select()
          .from(googleOauthExchangeAttempts)
          .where(eq(googleOauthExchangeAttempts.id, input.id))
          .for('update')
          .limit(1)
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
        await tx
          .update(googleOauthExchangeAttempts)
          .set({
            state: 'response_preserved',
            applyLeaseExpiresAt: null,
            outcomeCode: input.outcomeCode,
            updatedAt: input.now,
          })
          .where(eq(googleOauthExchangeAttempts.id, row.id))
        return success({ released: true as const })
      }),

    discardClaim: (input) =>
      db.transaction(async (tx) => {
        if (!OUTCOME_CODE.test(input.outcomeCode)) return fail('invalid_transition')
        const [row] = await tx
          .select()
          .from(googleOauthExchangeAttempts)
          .where(eq(googleOauthExchangeAttempts.id, input.id))
          .for('update')
          .limit(1)
        if (!row) return fail('not_found')
        if (!scopeMatches(row, input)) return fail('scope_mismatch')
        if (row.state !== 'applying') return fail('invalid_transition')
        await tx
          .update(googleOauthExchangeAttempts)
          .set({
            state: 'failed',
            encryptedResult: null,
            responseExpiresAt: null,
            applyLeaseExpiresAt: null,
            terminalAt: input.now,
            outcomeCode: input.outcomeCode,
            updatedAt: input.now,
          })
          .where(eq(googleOauthExchangeAttempts.id, row.id))
        return success({ discarded: true as const })
      }),

    finishWithoutResult: (input) =>
      db.transaction(async (tx) => {
        if (!OUTCOME_CODE.test(input.outcomeCode)) return fail('invalid_transition')
        const [row] = await tx
          .select()
          .from(googleOauthExchangeAttempts)
          .where(eq(googleOauthExchangeAttempts.id, input.id))
          .for('update')
          .limit(1)
        if (!row) return fail('not_found')
        if (!scopeMatches(row, input)) return fail('scope_mismatch')
        if (row.state !== 'prepared' && row.state !== 'provider_started') {
          return fail('invalid_transition')
        }
        await tx
          .update(googleOauthExchangeAttempts)
          .set({
            state: input.outcome,
            encryptedResult: null,
            responseExpiresAt: null,
            applyLeaseExpiresAt: null,
            terminalAt: input.now,
            outcomeCode: input.outcomeCode,
            updatedAt: input.now,
          })
          .where(eq(googleOauthExchangeAttempts.id, row.id))
        return success({ finished: true as const })
      }),

    expire: async (input) => {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        return { expired: 0 }
      }
      return db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(googleOauthExchangeAttempts)
          .where(
            or(
              and(
                inArray(googleOauthExchangeAttempts.state, [
                  'response_preserved',
                  'applying',
                ]),
                lte(googleOauthExchangeAttempts.responseExpiresAt, input.now),
              ),
              and(
                inArray(googleOauthExchangeAttempts.state, [
                  'prepared',
                  'provider_started',
                ]),
                lte(
                  googleOauthExchangeAttempts.createdAt,
                  new Date(input.now.getTime() - GOOGLE_OAUTH_EXCHANGE_RESPONSE_TTL_MS),
                ),
              ),
            ),
          )
          .orderBy(asc(googleOauthExchangeAttempts.createdAt))
          .limit(input.limit)
          .for('update', { skipLocked: true })
        for (const row of rows) {
          const ambiguous = row.state === 'provider_started'
          await tx
            .update(googleOauthExchangeAttempts)
            .set({
              state: ambiguous ? 'provider_outcome_ambiguous' : 'expired',
              encryptedResult: null,
              responseExpiresAt: null,
              applyLeaseExpiresAt: null,
              terminalAt: input.now,
              outcomeCode: ambiguous
                ? 'provider_result_not_preserved'
                : 'attempt_expired',
              updatedAt: input.now,
            })
            .where(eq(googleOauthExchangeAttempts.id, row.id))
        }
        return { expired: rows.length }
      })
    },
  })
}
