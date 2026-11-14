import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createGoogleConnectionTestStore } from '#/contexts/integration/connections/google-connection.test-fixtures'
import { createTestTokenEncryption } from '#/contexts/integration/connections/token-encryption.test-fixtures'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
} from '../../../../../test-fixtures/generated/google-provider-identifiers-v1'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderExecutionResult,
} from '../../application/ports/google-authorized-provider-executor.port'
import { translatedGoogleReviewApi } from '#/contexts/review/application/public-api'
import { createGoogleReviewApiAdapter } from './google-review-api.adapter'

const NOW = new Date('2026-08-12T12:00:00Z')
const REQUEST = {
  organizationId: organizationId('synthetic-organization'),
  propertyId: propertyId('00000000-0000-4000-8000-000000000002'),
  connectionId: googleConnectionId('00000000-0000-4000-8000-000000000003'),
  sourceEpoch: 17,
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
}
const AUTHORIZATION = {
  capability: 'property.connect_gbp',
  organizationId: REQUEST.organizationId,
  propertyId: REQUEST.propertyId,
  connectionId: REQUEST.connectionId,
  initiatorUserId: null,
  expectedCredentialGeneration: 3,
  authorizationVector: { generation: 3, propertySourceEpoch: REQUEST.sourceEpoch },
} satisfies GoogleProviderCallAuthorization

setupIntegrationDb({
  orgA: REQUEST.organizationId,
  orgB: organizationId('synthetic-organization-b'),
  tables: ['google_connections'],
})

async function createAdapter(execute: GoogleAuthorizedProviderExecutor['execute']) {
  const connectionRepo = createGoogleConnectionTestStore(getDb(), () => NOW, [
    REQUEST.organizationId,
  ])
  await connectionRepo.seed([
    {
      id: REQUEST.connectionId,
      organizationId: REQUEST.organizationId,
      googleSubject: 'synthetic-subject',
      googleAccountEmail: null,
      encryptedAccessToken: createTestTokenEncryption().encrypt('access'),
      encryptedRefreshToken: createTestTokenEncryption().encrypt('refresh'),
      tokenExpiresAt: NOW,
      scopes: ['https://www.googleapis.com/auth/business.manage'],
      credentialAuthorizedBy: userId('synthetic-user'),
      connectedBy: userId('synthetic-user'),
      visibility: 'organization',
      status: 'active',
      credentialUseState: 'active',
      cleanupMaterialDeadlineAt: null,
      lifecycleVersion: 7,
      accessVersion: 11,
      credentialGeneration: 3,
      encryptionKeyId: 'v1',
      lastSuccessfulSyncAt: null,
      statusReason: null,
      statusChangedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ])
  const authorize = vi.fn(async () => ({
    accessToken: 'synthetic-access-token',
    authorization: AUTHORIZATION,
  }))
  const raw = createGoogleReviewApiAdapter({
    connectionRepo,
    logger: createMockLogger(),
    cursorStore: {
      redeem: vi.fn(),
      release: vi.fn(),
      publishNext: vi.fn(),
      discardRun: vi.fn(),
      startedAtMs: vi.fn(),
    },
    executor: { execute },
    authorizeReviewSyncProviderCall: authorize,
    nowMs: () => NOW.getTime(),
  })
  return { api: translatedGoogleReviewApi(raw), raw, authorize }
}

function response(status: number, body: Uint8Array): GoogleProviderExecutionResult {
  return {
    ok: true,
    status,
    headers: { contentType: 'application/json', cacheControl: null, retryAfter: null },
    body,
  }
}

afterEach(() => vi.useRealTimers())

describe('single-review provider transport', () => {
  it('bounds a non-cooperative executor and scrubs its late response', async () => {
    let complete!: (result: GoogleProviderExecutionResult) => void
    const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const { api, authorize } = await createAdapter(execute)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let outcome: unknown = 'pending'
    const read = api.getReview(REQUEST).then(
      (result) => {
        outcome = result
      },
      (error: unknown) => {
        outcome = error
      },
    )
    // The connection read is real I/O: let it finish before the clock moves.
    while (execute.mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    await vi.advanceTimersByTimeAsync(29_999)
    expect(outcome).toBe('pending')
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ routeKey: 'reviews.get' }),
      expect.objectContaining({ deadlineMs: NOW.getTime() + 30_000 }),
    )
    await vi.advanceTimersByTimeAsync(1)
    const atDeadline = outcome
    const body = new TextEncoder().encode('{"late":"synthetic-content"}')
    complete(response(200, body))
    await read
    expect(atDeadline).toMatchObject({
      code: 'provider_unavailable',
      recoverable: true,
      failure: { dispatch: 'unknown' },
    })
    expect(body.every((byte) => byte === 0)).toBe(true)
    expect(authorize).toHaveBeenCalledTimes(1)
  })

  it('keeps the allowlisted refusal before scrubbing the provider body', async () => {
    const body = new TextEncoder().encode(
      JSON.stringify({
        error: { status: 'PERMISSION_DENIED', message: 'synthetic provider content' },
      }),
    )
    const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(async () =>
      response(403, body),
    )
    const { api } = await createAdapter(execute)
    await expect(api.getReview(REQUEST)).rejects.toMatchObject({
      code: 'authorization_changed',
      recoverable: false,
      failure: {
        dispatch: 'answered',
        providerStatus: 403,
        providerErrorStatus: 'PERMISSION_DENIED',
      },
    })
    expect(body.every((byte) => byte === 0)).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('throws the provider failure itself for the use case to translate', async () => {
    const body = new TextEncoder().encode(
      JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'synthetic' } }),
    )
    const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(async () =>
      response(403, body),
    )
    const { raw } = await createAdapter(execute)
    await expect(raw.getReview(REQUEST)).rejects.toMatchObject({
      _tag: 'GbpApiError',
      code: 'permission_denied',
      dispatch: 'answered',
      providerStatus: 403,
      providerErrorStatus: 'PERMISSION_DENIED',
    })
  })

  it.each([
    ['invalid UTF-8', new Uint8Array([0xff])],
    ['invalid JSON', new TextEncoder().encode('{')],
    ['an oversized body', new Uint8Array(5 * 1024 * 1024 + 1).fill(32)],
  ])('keeps %s as a terminal malformed response and scrubs it', async (_label, body) => {
    const { api } = await createAdapter(async () => response(200, body))
    await expect(api.getReview(REQUEST)).rejects.toMatchObject({
      code: 'malformed_response',
      recoverable: false,
    })
    expect(body.every((byte) => byte === 0)).toBe(true)
  })
})
