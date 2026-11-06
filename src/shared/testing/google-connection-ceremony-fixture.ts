// Integration context — connect Google account use case tests

import { vi } from 'vitest'
import { connectGoogleAccount } from '#/contexts/integration/application/use-cases/connect-google-account'
import type { GoogleConnection } from '#/contexts/integration/domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createSequentialIntegrationCommandStore } from '#/shared/testing/sequential-integration-command-store'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import type { GoogleOAuthProviderCallAuthorizer } from '#/contexts/integration/application/ports/google-oauth.port'
import type {
  GoogleOAuthExchangeAttemptFacts,
  GoogleOAuthExchangeRecoveryStore,
} from '#/contexts/integration/application/google-oauth-exchange-recovery'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

export const createGoogleConnectionCeremonyFixture = (
  authorizeProviderCall?: GoogleOAuthProviderCallAuthorizer,
  refreshBoundGoogleCategories?: (
    connection: GoogleConnection,
    actor: AuthContext,
  ) => Promise<void>,
) => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const oauth = createInMemoryGoogleOAuthPort()
  let attempt:
    | (GoogleOAuthExchangeAttemptFacts & {
        state:
          | 'prepared'
          | 'provider_started'
          | 'response_preserved'
          | 'applying'
          | 'completed'
        encryptedResult?: string
      })
    | undefined
  const finishWithoutResult = vi.fn<
    GoogleOAuthExchangeRecoveryStore['finishWithoutResult']
  >(async () => ({ ok: true, value: { finished: true } }))
  const exchangeRecovery: GoogleOAuthExchangeRecoveryStore = {
    begin: async (value) => {
      attempt = { ...value, state: 'prepared' }
      return { ok: true, value: { state: 'prepared' } }
    },
    markProviderStarted: async () => {
      if (!attempt || attempt.state !== 'prepared') {
        return { ok: false, code: 'invalid_transition' }
      }
      attempt.state = 'provider_started'
      return { ok: true, value: { started: true } }
    },
    preserveSuccessfulResult: async ({ encryptedResult }) => {
      if (!attempt || attempt.state !== 'provider_started') {
        return { ok: false, code: 'invalid_transition' }
      }
      attempt.state = 'response_preserved'
      attempt.encryptedResult = encryptedResult
      return { ok: true, value: { preserved: true } }
    },
    claimPreservedResult: async () => {
      if (attempt?.state === 'completed') {
        return { ok: false, code: 'completed' }
      }
      if (
        !attempt ||
        attempt.state !== 'response_preserved' ||
        !attempt.encryptedResult
      ) {
        return { ok: false, code: 'invalid_transition' }
      }
      attempt.state = 'applying'
      return {
        ok: true,
        value: { ...attempt, encryptedResult: attempt.encryptedResult },
      } as const satisfies Awaited<
        ReturnType<GoogleOAuthExchangeRecoveryStore['claimPreservedResult']>
      >
    },
    loadCompletedAttempt: async ({ id, organizationId, initiatorUserId }) =>
      attempt?.state === 'completed' &&
      attempt.id === id &&
      attempt.organizationId === organizationId &&
      attempt.initiatorUserId === initiatorUserId
        ? attempt
        : null,
    releaseClaim: async () => ({ ok: true, value: { released: true } }),
    discardClaim: async () => ({ ok: true, value: { discarded: true } }),
    finishWithoutResult,
    expire: async () => ({ expired: 0 }),
  }
  const originalExchange = oauth.exchangeCode
  const exchangeCode = vi.fn(async (request: Parameters<typeof originalExchange>[0]) => {
    if (request.preservedResult) {
      return {
        identity: {
          kind: 'oidc' as const,
          googleSubject: 'google-subject-123',
          email: 'owner@example.com',
        },
        accessToken: request.preservedResult.accessToken,
        refreshToken: request.preservedResult.refreshToken,
        expiresIn: request.preservedResult.expiresIn,
        scopes: request.preservedResult.scopes,
      }
    }
    const result = await originalExchange(request)
    await request.preserveSuccessfulResult?.({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      scopes: result.scopes,
      idToken: 'fake-signed-id-token',
    })
    return result
  })
  const recoverableOauth = {
    ...oauth,
    exchangeCode,
  }
  const encryption = createInMemoryTokenEncryption()
  const outbox = createRecordedOutbox()
  const deps = {
    connectionRepo,
    oauth: recoverableOauth,
    encryption,
    commandStore: createSequentialIntegrationCommandStore({ connectionRepo, outbox }),
    exchangeRecovery,
    clock: () => FIXED_TIME,
    idGen: () => 'test-connection-id',
    callbackUrl: 'http://localhost:3000/api/auth/google/callback',
    ...(authorizeProviderCall ? { authorizeProviderCall } : {}),
    refreshBoundGoogleCategories,
  }
  const useCase = connectGoogleAccount(deps)
  return {
    useCase,
    connectionRepo,
    oauth,
    exchangeCode,
    outbox,
    finishWithoutResult,
    markAttemptCompleted: () => {
      if (!attempt || attempt.state !== 'applying') {
        throw new Error('Expected an applying OAuth exchange attempt')
      }
      attempt.state = 'completed'
      delete attempt.encryptedResult
    },
  }
}
