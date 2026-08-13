import { timingSafeEqual } from 'node:crypto'
import { and, asc, eq, inArray, lte, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  authorizationExecutionPermits,
  credentialRevokePermits,
  googleCredentialSourceOperations,
  googleSubjectAuthorityGuards,
} from '#/shared/db/schema'
import { CREDENTIAL_AUTHORIZATION_VECTOR_KEYS } from '../../application/credential-lifecycle'
import type {
  CredentialCleanupOutcome,
  CredentialLifecycleResult,
  CredentialLifecycleStore,
  CredentialSourceRegistration,
} from '../../application/credential-lifecycle'

const HMAC = /^[A-Za-z0-9_-]{32,128}$/
const VERSION = /^[a-z][a-z0-9_-]{0,49}$/
const OUTCOME = /^[a-z][a-z0-9_.-]{0,99}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const fail = <T>(
  code: Extract<CredentialLifecycleResult<T>, { ok: false }>['code'],
): CredentialLifecycleResult<T> => ({ ok: false, code })
const success = <T>(value: T): CredentialLifecycleResult<T> => ({ ok: true, value })

function safeHmac(version: string, digest: string): boolean {
  return VERSION.test(version) && HMAC.test(digest)
}

function sameDigest(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function validRegistration(input: CredentialSourceRegistration): boolean {
  return (
    safeHmac(
      input.guardKey.projectClientHmacKeyVersion,
      input.guardKey.projectClientHmac,
    ) &&
    safeHmac(input.guardKey.subjectHmacKeyVersion, input.guardKey.subjectHmac) &&
    UUID.test(input.sourceOperationId) &&
    UUID.test(input.revokePermitId) &&
    UUID.test(input.sourceWorkPermitId) &&
    (input.connectionId === null || UUID.test(input.connectionId)) &&
    input.organizationId.length > 0 &&
    input.cleanupDeadlineAt > input.now &&
    [
      input.expectedLifecycleVersion,
      input.expectedAccessVersion,
      input.expectedCredentialGeneration,
    ].every((value) => Number.isSafeInteger(value) && value >= 1)
  )
}

export function createCredentialLifecycleRepository(
  db: Database,
): CredentialLifecycleStore {
  return Object.freeze({
    registerSource: async (input) => {
      if (!validRegistration(input)) return fail('invalid_transition')
      return db.transaction(async (tx) => {
        const [sourcePermit] = await tx
          .select()
          .from(authorizationExecutionPermits)
          .where(eq(authorizationExecutionPermits.id, input.sourceWorkPermitId))
          .for('update')
          .limit(1)
        if (!sourcePermit) return fail('not_found')
        if (
          sourcePermit.organizationId !== input.organizationId ||
          sourcePermit.connectionId !== input.connectionId
        ) {
          return fail('scope_mismatch')
        }
        if (
          sourcePermit.state !== 'started' ||
          !sourcePermit.operationDeadlineAt ||
          sourcePermit.operationDeadlineAt <= input.now
        ) {
          return fail(
            sourcePermit.operationDeadlineAt &&
              sourcePermit.operationDeadlineAt <= input.now
              ? 'deadline_exceeded'
              : 'invalid_transition',
          )
        }
        const vector = sourcePermit.authorizationVector
        if (
          vector[CREDENTIAL_AUTHORIZATION_VECTOR_KEYS.lifecycleVersion] !==
            input.expectedLifecycleVersion ||
          vector[CREDENTIAL_AUTHORIZATION_VECTOR_KEYS.accessVersion] !==
            input.expectedAccessVersion ||
          vector[CREDENTIAL_AUTHORIZATION_VECTOR_KEYS.credentialGeneration] !==
            input.expectedCredentialGeneration
        ) {
          return fail('scope_mismatch')
        }
        await tx
          .insert(googleSubjectAuthorityGuards)
          .values({
            projectClientHmacKeyVersion: input.guardKey.projectClientHmacKeyVersion,
            projectClientHmac: input.guardKey.projectClientHmac,
            subjectHmacKeyVersion: input.guardKey.subjectHmacKeyVersion,
            subjectHmac: input.guardKey.subjectHmac,
            generation: 0,
            nextSequence: 1,
            state: 'open',
            updatedAt: input.now,
          })
          .onConflictDoNothing({
            target: [
              googleSubjectAuthorityGuards.projectClientHmacKeyVersion,
              googleSubjectAuthorityGuards.projectClientHmac,
              googleSubjectAuthorityGuards.subjectHmacKeyVersion,
              googleSubjectAuthorityGuards.subjectHmac,
            ],
          })
        const [guard] = await tx
          .select()
          .from(googleSubjectAuthorityGuards)
          .where(
            and(
              eq(
                googleSubjectAuthorityGuards.projectClientHmacKeyVersion,
                input.guardKey.projectClientHmacKeyVersion,
              ),
              eq(
                googleSubjectAuthorityGuards.projectClientHmac,
                input.guardKey.projectClientHmac,
              ),
              eq(
                googleSubjectAuthorityGuards.subjectHmacKeyVersion,
                input.guardKey.subjectHmacKeyVersion,
              ),
              eq(googleSubjectAuthorityGuards.subjectHmac, input.guardKey.subjectHmac),
            ),
          )
          .for('update')
          .limit(1)
        if (!guard) return fail('not_found')
        if (!['open', 'drained'].includes(guard.state) || guard.activeSourceOperationId) {
          return fail('concurrent_operation')
        }
        const sequence = guard.nextSequence
        await tx.insert(googleCredentialSourceOperations).values({
          id: input.sourceOperationId,
          guardId: guard.id,
          sourceWorkPermitId: input.sourceWorkPermitId,
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          sequence,
          kind: input.kind,
          state: 'registered',
          expectedLifecycleVersion: input.expectedLifecycleVersion,
          expectedAccessVersion: input.expectedAccessVersion,
          expectedCredentialGeneration: input.expectedCredentialGeneration,
          operationDeadlineAt: sourcePermit.operationDeadlineAt,
          createdAt: input.now,
          updatedAt: input.now,
        })
        await tx.insert(credentialRevokePermits).values({
          id: input.revokePermitId,
          guardId: guard.id,
          sourceOperationId: input.sourceOperationId,
          state: 'dormant',
          cleanupDeadlineAt: input.cleanupDeadlineAt,
          createdAt: input.now,
          updatedAt: input.now,
        })
        await tx
          .update(googleSubjectAuthorityGuards)
          .set({
            generation: guard.generation + 1,
            nextSequence: sequence + 1,
            activeSourceOperationId: input.sourceOperationId,
            state: 'source_active',
            cleanupDeadlineAt: input.cleanupDeadlineAt,
            updatedAt: input.now,
          })
          .where(eq(googleSubjectAuthorityGuards.id, guard.id))
        return success({ guardId: guard.id, sequence })
      })
    },

    markProviderStarted: async (input) =>
      db.transaction(async (tx) => {
        const [source] = await tx
          .select()
          .from(googleCredentialSourceOperations)
          .where(eq(googleCredentialSourceOperations.id, input.sourceOperationId))
          .for('update')
          .limit(1)
        if (!source) return fail('not_found')
        if (source.organizationId !== input.organizationId) return fail('scope_mismatch')
        if (source.operationDeadlineAt <= input.now) return fail('deadline_exceeded')
        if (source.state !== 'registered') return fail('invalid_transition')
        const [guard] = await tx
          .select()
          .from(googleSubjectAuthorityGuards)
          .where(eq(googleSubjectAuthorityGuards.id, source.guardId))
          .for('update')
          .limit(1)
        if (
          !guard ||
          guard.state !== 'source_active' ||
          guard.activeSourceOperationId !== source.id ||
          guard.sourceCutoffSequence !== null
        ) {
          return fail('stale_sequence')
        }
        await tx
          .update(googleCredentialSourceOperations)
          .set({
            state: 'provider_started',
            providerStartedAt: input.now,
            updatedAt: input.now,
          })
          .where(eq(googleCredentialSourceOperations.id, source.id))
        return success({ sequence: source.sequence })
      }),

    completeWithoutCleanup: async (input) =>
      db.transaction(async (tx) => {
        if (!OUTCOME.test(input.outcomeCode)) return fail('invalid_transition')
        const [source] = await tx
          .select()
          .from(googleCredentialSourceOperations)
          .where(eq(googleCredentialSourceOperations.id, input.sourceOperationId))
          .for('update')
          .limit(1)
        if (!source) return fail('not_found')
        if (source.organizationId !== input.organizationId) return fail('scope_mismatch')
        if (source.state !== 'provider_started') return fail('invalid_transition')
        const [guard] = await tx
          .select()
          .from(googleSubjectAuthorityGuards)
          .where(eq(googleSubjectAuthorityGuards.id, source.guardId))
          .for('update')
          .limit(1)
        if (!guard || guard.activeSourceOperationId !== source.id) {
          return fail('stale_sequence')
        }
        await tx
          .update(googleCredentialSourceOperations)
          .set({
            state: 'terminal',
            terminalAt: input.now,
            outcomeCode: input.outcomeCode,
            updatedAt: input.now,
          })
          .where(eq(googleCredentialSourceOperations.id, source.id))
        await tx
          .update(credentialRevokePermits)
          .set({
            state: 'consumed_no_revoke',
            terminalAt: input.now,
            outcomeCode: 'no_rotated_credential',
            updatedAt: input.now,
          })
          .where(eq(credentialRevokePermits.sourceOperationId, source.id))
        await tx
          .update(googleSubjectAuthorityGuards)
          .set({
            state: 'drained',
            activeSourceOperationId: null,
            sourceCutoffSequence: source.sequence,
            updatedAt: input.now,
          })
          .where(eq(googleSubjectAuthorityGuards.id, source.guardId))
        return success({ sequence: source.sequence })
      }),

    activateCleanup: async (input) =>
      db.transaction(async (tx) => {
        if (
          !safeHmac(input.tokenHmacKeyVersion, input.tokenHmac) ||
          !OUTCOME.test(input.outcomeCode)
        ) {
          return fail('invalid_transition')
        }
        const [source] = await tx
          .select()
          .from(googleCredentialSourceOperations)
          .where(eq(googleCredentialSourceOperations.id, input.sourceOperationId))
          .for('update')
          .limit(1)
        if (!source) return fail('not_found')
        if (source.organizationId !== input.organizationId) return fail('scope_mismatch')
        if (source.state !== 'provider_started') return fail('invalid_transition')
        const [revoke] = await tx
          .select()
          .from(credentialRevokePermits)
          .where(eq(credentialRevokePermits.sourceOperationId, source.id))
          .for('update')
          .limit(1)
        if (!revoke || revoke.state !== 'dormant') return fail('invalid_transition')
        if (
          input.now >= revoke.cleanupDeadlineAt ||
          input.sendAuthorizationExpiresAt <= input.now ||
          input.sendAuthorizationExpiresAt > revoke.cleanupDeadlineAt
        ) {
          return fail('deadline_exceeded')
        }
        await tx
          .update(googleCredentialSourceOperations)
          .set({
            state: 'terminal',
            terminalAt: input.now,
            outcomeCode: input.outcomeCode,
            updatedAt: input.now,
          })
          .where(eq(googleCredentialSourceOperations.id, source.id))
        await tx
          .update(credentialRevokePermits)
          .set({
            state: 'active',
            tokenHmacKeyVersion: input.tokenHmacKeyVersion,
            tokenHmac: input.tokenHmac,
            sendAuthorizationExpiresAt: input.sendAuthorizationExpiresAt,
            activatedAt: input.now,
            updatedAt: input.now,
          })
          .where(eq(credentialRevokePermits.id, revoke.id))
        await tx
          .update(googleSubjectAuthorityGuards)
          .set({
            state: 'cleanup_pending',
            activeSourceOperationId: null,
            sourceCutoffSequence: source.sequence,
            updatedAt: input.now,
          })
          .where(eq(googleSubjectAuthorityGuards.id, source.guardId))
        return success({ revokePermitId: revoke.id, sequence: source.sequence })
      }),

    finishCleanupWithoutDispatch: async (input) =>
      db.transaction(async (tx) => {
        if (!OUTCOME.test(input.outcomeCode)) return fail('invalid_transition')
        const [revoke] = await tx
          .select()
          .from(credentialRevokePermits)
          .where(eq(credentialRevokePermits.id, input.revokePermitId))
          .for('update')
          .limit(1)
        if (!revoke) return fail('not_found')
        const [source] = await tx
          .select()
          .from(googleCredentialSourceOperations)
          .where(eq(googleCredentialSourceOperations.id, revoke.sourceOperationId))
          .limit(1)
        if (!source) return fail('not_found')
        if (source.organizationId !== input.organizationId) {
          return fail('scope_mismatch')
        }
        if (revoke.state !== 'active') return fail('invalid_transition')
        await tx
          .update(credentialRevokePermits)
          .set({
            state: 'confirmed_not_sent',
            tokenHmacKeyVersion: null,
            tokenHmac: null,
            sendAuthorizationExpiresAt: null,
            terminalAt: input.now,
            outcomeCode: input.outcomeCode,
            updatedAt: input.now,
          })
          .where(eq(credentialRevokePermits.id, revoke.id))
        await tx
          .update(googleSubjectAuthorityGuards)
          .set({ state: 'drained', updatedAt: input.now })
          .where(eq(googleSubjectAuthorityGuards.id, revoke.guardId))
        return success({ sourceOperationId: source.id })
      }),

    acquireCleanupDispatch: async (input) =>
      db.transaction(async (tx) => {
        if (!safeHmac(input.tokenHmacKeyVersion, input.tokenHmac)) {
          return fail('token_mismatch')
        }
        const [revoke] = await tx
          .select()
          .from(credentialRevokePermits)
          .where(eq(credentialRevokePermits.id, input.revokePermitId))
          .for('update')
          .limit(1)
        if (!revoke) return fail('not_found')
        const [source] = await tx
          .select()
          .from(googleCredentialSourceOperations)
          .where(eq(googleCredentialSourceOperations.id, revoke.sourceOperationId))
          .limit(1)
        if (!source) return fail('not_found')
        if (source.organizationId !== input.organizationId) return fail('scope_mismatch')
        if (revoke.state !== 'active') return fail('invalid_transition')
        if (
          !revoke.sendAuthorizationExpiresAt ||
          revoke.sendAuthorizationExpiresAt <= input.now ||
          revoke.cleanupDeadlineAt <= input.now
        ) {
          return fail('deadline_exceeded')
        }
        if (
          revoke.tokenHmacKeyVersion !== input.tokenHmacKeyVersion ||
          !revoke.tokenHmac ||
          !sameDigest(revoke.tokenHmac, input.tokenHmac)
        ) {
          return fail('token_mismatch')
        }
        await tx
          .update(credentialRevokePermits)
          .set({
            state: 'dispatching',
            tokenHmacKeyVersion: null,
            tokenHmac: null,
            sendAuthorizationExpiresAt: null,
            dispatchingAt: input.now,
            updatedAt: input.now,
          })
          .where(eq(credentialRevokePermits.id, revoke.id))
        return success({ sourceOperationId: source.id })
      }),

    finishCleanup: async (input) =>
      db.transaction(async (tx) => {
        if (!OUTCOME.test(input.outcomeCode)) return fail('invalid_transition')
        const [revoke] = await tx
          .select()
          .from(credentialRevokePermits)
          .where(eq(credentialRevokePermits.id, input.revokePermitId))
          .for('update')
          .limit(1)
        if (!revoke) return fail('not_found')
        const [source] = await tx
          .select()
          .from(googleCredentialSourceOperations)
          .where(eq(googleCredentialSourceOperations.id, revoke.sourceOperationId))
          .limit(1)
        if (!source) return fail('not_found')
        if (source.organizationId !== input.organizationId) return fail('scope_mismatch')
        if (revoke.state !== 'dispatching') return fail('invalid_transition')
        const guardState = cleanupGuardState(input.outcome)
        await tx
          .update(credentialRevokePermits)
          .set({
            state: input.outcome,
            terminalAt: input.now,
            outcomeCode: input.outcomeCode,
            updatedAt: input.now,
          })
          .where(eq(credentialRevokePermits.id, revoke.id))
        await tx
          .update(googleSubjectAuthorityGuards)
          .set({ state: guardState, updatedAt: input.now })
          .where(eq(googleSubjectAuthorityGuards.id, revoke.guardId))
        return success({ sourceOperationId: source.id })
      }),

    markProviderOutcomeAmbiguous: async (input) =>
      db.transaction(async (tx) => {
        if (!OUTCOME.test(input.outcomeCode)) return fail('invalid_transition')
        const [source] = await tx
          .select()
          .from(googleCredentialSourceOperations)
          .where(eq(googleCredentialSourceOperations.id, input.sourceOperationId))
          .for('update')
          .limit(1)
        if (!source) return fail('not_found')
        if (source.organizationId !== input.organizationId) return fail('scope_mismatch')
        if (source.state !== 'provider_started') return fail('invalid_transition')
        await tx
          .update(googleCredentialSourceOperations)
          .set({
            state: 'provider_outcome_ambiguous',
            outcomeCode: input.outcomeCode,
            updatedAt: input.now,
          })
          .where(eq(googleCredentialSourceOperations.id, source.id))
        await tx
          .update(credentialRevokePermits)
          .set({
            state: 'cleanup_ambiguous',
            terminalAt: input.now,
            outcomeCode: input.outcomeCode,
            updatedAt: input.now,
          })
          .where(eq(credentialRevokePermits.sourceOperationId, source.id))
        await tx
          .update(googleSubjectAuthorityGuards)
          .set({
            state: 'ambiguous',
            activeSourceOperationId: null,
            sourceCutoffSequence: source.sequence,
            updatedAt: input.now,
          })
          .where(eq(googleSubjectAuthorityGuards.id, source.guardId))
        return success({ sequence: source.sequence })
      }),
    expireDeadlines: async (input) => {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        return { expired: 0 }
      }
      return db.transaction(async (tx) => {
        const rows = await tx
          .select({
            revokeId: credentialRevokePermits.id,
            revokeState: credentialRevokePermits.state,
            guardId: credentialRevokePermits.guardId,
            sourceId: googleCredentialSourceOperations.id,
            sourceState: googleCredentialSourceOperations.state,
            sourceSequence: googleCredentialSourceOperations.sequence,
          })
          .from(credentialRevokePermits)
          .innerJoin(
            googleCredentialSourceOperations,
            eq(
              googleCredentialSourceOperations.id,
              credentialRevokePermits.sourceOperationId,
            ),
          )
          .where(
            and(
              inArray(credentialRevokePermits.state, [
                'dormant',
                'active',
                'dispatching',
              ]),
              or(
                lte(credentialRevokePermits.cleanupDeadlineAt, input.now),
                and(
                  eq(credentialRevokePermits.state, 'active'),
                  lte(credentialRevokePermits.sendAuthorizationExpiresAt, input.now),
                ),
              ),
            ),
          )
          .orderBy(asc(credentialRevokePermits.cleanupDeadlineAt))
          .limit(input.limit)
          .for('update')

        for (const row of rows) {
          const ambiguous =
            row.revokeState === 'dispatching' ||
            (row.revokeState === 'dormant' && row.sourceState === 'provider_started')
          if (row.revokeState === 'dormant') {
            await tx
              .update(googleCredentialSourceOperations)
              .set(
                ambiguous
                  ? {
                      state: 'provider_outcome_ambiguous',
                      outcomeCode: 'cleanup_deadline_elapsed',
                      updatedAt: input.now,
                    }
                  : {
                      state: 'terminal',
                      terminalAt: input.now,
                      outcomeCode: 'deadline_before_provider_send',
                      updatedAt: input.now,
                    },
              )
              .where(eq(googleCredentialSourceOperations.id, row.sourceId))
          }
          await tx
            .update(credentialRevokePermits)
            .set({
              state: ambiguous ? 'cleanup_ambiguous' : 'confirmed_not_sent',
              tokenHmacKeyVersion: null,
              tokenHmac: null,
              sendAuthorizationExpiresAt: null,
              terminalAt: input.now,
              outcomeCode: ambiguous
                ? 'cleanup_deadline_ambiguous'
                : 'cleanup_authorization_expired',
              updatedAt: input.now,
            })
            .where(eq(credentialRevokePermits.id, row.revokeId))
          await tx
            .update(googleSubjectAuthorityGuards)
            .set({
              state: ambiguous ? 'ambiguous' : 'drained',
              activeSourceOperationId: null,
              sourceCutoffSequence: row.sourceSequence,
              cleanupDeadlineAt: null,
              updatedAt: input.now,
            })
            .where(eq(googleSubjectAuthorityGuards.id, row.guardId))
        }
        return { expired: rows.length }
      })
    },
  })
}

function cleanupGuardState(
  outcome: CredentialCleanupOutcome,
): 'drained' | 'ambiguous' | 'provider_reset_terminal' {
  if (outcome === 'cleanup_ambiguous') return 'ambiguous'
  if (outcome === 'provider_reset_confirmed') return 'provider_reset_terminal'
  return 'drained'
}
