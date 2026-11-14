// Integration context — connect Google account use case tests

import { vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { idempotencyReceipts } from '#/shared/db/schema'
import { createAtomicIntegrationCommandStore } from '#/contexts/integration/infrastructure/integration-command-store'
import { createGoogleOAuthExchangeRecoveryRepository } from '#/contexts/integration/infrastructure/repositories/google-oauth-exchange-recovery.repository'
import {
  createGoogleConnectionTestStore,
  createOutboxReader,
} from '#/contexts/integration/connections/google-connection.test-fixtures'
import { connectGoogleAccount } from '#/contexts/integration/application/use-cases/connect-google-account'
import type { GoogleConnection } from '#/contexts/integration/domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createTestTokenEncryption } from '#/contexts/integration/connections/token-encryption.test-fixtures'
import type { GoogleOAuthProviderCallAuthorizer } from '#/contexts/integration/application/ports/google-oauth.port'
import type { GoogleOAuthExchangeRecoveryStore } from '#/contexts/integration/application/google-oauth-exchange-recovery'

// Organization of buildTestAuthContext unless a test passes its own.
const DEFAULT_TEST_ORG_ID = 'org-00000000-0000-0000-0000-000000000001'
// Organization the ceremony tests use for a subject another tenant already holds.
const OTHER_TEST_ORG_ID = 'org-connect-gc-other'
const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const EXCHANGE_RECEIPT_SCOPE = 'google_oauth_exchange'

/**
 * The ceremony against real PostgreSQL: production repository, command store and
 * exchange-recovery store; only the Google transport is stubbed. Callers own the
 * Organization rows and `google_connections` / `outbox_events` cleanup
 * (setupIntegrationDb); this clears the exchange receipts, which carry no
 * Organization column.
 */
export const createGoogleConnectionCeremonyFixture = async (
  authorizeProviderCall?: GoogleOAuthProviderCallAuthorizer,
  refreshBoundGoogleCategories?: (
    connection: GoogleConnection,
    actor: AuthContext,
  ) => Promise<void>,
) => {
  const db = getDb()
  await db
    .delete(idempotencyReceipts)
    .where(eq(idempotencyReceipts.scope, EXCHANGE_RECEIPT_SCOPE))
  const connectionRepo = createGoogleConnectionTestStore(db, () => FIXED_TIME, [
    DEFAULT_TEST_ORG_ID,
    OTHER_TEST_ORG_ID,
  ])
  const oauth = createInMemoryGoogleOAuthPort()
  const exchangeRecovery = createGoogleOAuthExchangeRecoveryRepository(db)
  const finishWithoutResult = vi.fn<
    GoogleOAuthExchangeRecoveryStore['finishWithoutResult']
  >(exchangeRecovery.finishWithoutResult)
  const recovery: GoogleOAuthExchangeRecoveryStore = {
    ...exchangeRecovery,
    finishWithoutResult,
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
  const encryption = createTestTokenEncryption()
  const outbox = createOutboxReader(db, [DEFAULT_TEST_ORG_ID, OTHER_TEST_ORG_ID])
  const deps = {
    connectionRepo,
    oauth: recoverableOauth,
    encryption,
    commandStore: createAtomicIntegrationCommandStore(db, () => FIXED_TIME),
    exchangeRecovery: recovery,
    clock: () => FIXED_TIME,
    idGen: () => '60000000-0000-4000-8000-0000000000c1',
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
  }
}
