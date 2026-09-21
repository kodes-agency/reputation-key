import { describe, expect, it, vi } from 'vitest'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderExecutionResult,
} from '../../application/ports/google-authorized-provider-executor.port'
import { integrationError } from '../../domain/errors'
import { createSingle401RefreshExecutor } from './google-single-401-refresh-executor'

const AUTHORIZATION: GoogleProviderCallAuthorization = Object.freeze({
  capability: 'property.connect_gbp',
  organizationId: organizationId('organization-1'),
  propertyId: propertyId('22222222-2222-4222-8222-222222222222'),
  connectionId: googleConnectionId('11111111-1111-4111-8111-111111111111'),
  initiatorUserId: null,
  expectedCredentialGeneration: 3,
  authorizationVector: Object.freeze({ credentialGeneration: 3 }),
})
const DESCRIPTOR = Object.freeze({
  routeKey: 'account-management.accounts.list' as const,
  accessToken: 'stale-access-token',
})
const OPTIONS = Object.freeze({ authorization: AUTHORIZATION, deadlineMs: 10_000 })

const unauthorized = (): GoogleProviderExecutionResult => ({
  ok: true,
  status: 401,
  headers: { contentType: 'application/json', cacheControl: null, retryAfter: null },
  body: new TextEncoder().encode('{}'),
})

function refreshingExecutor(results: readonly GoogleProviderExecutionResult[]) {
  const queue = [...results]
  const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(async () => {
    const next = queue.shift()
    if (!next) throw new Error('unexpected provider execution')
    return next
  })
  const executor = createSingle401RefreshExecutor({
    executor: { execute },
    refreshAccessToken: async () => undefined,
    getAccessToken: async () => 'fresh-access-token',
    reauthorize: async ({ authorization }) => authorization,
  })
  return { executor, execute }
}

// The reply publication workflow reads dispatch evidence from whatever this
// wrapper returns. The evidence describes the whole call, not only its last
// execution: `not_sent` is the one value that lets a failed write be sent
// again (CONTRACT-REPLY hard rule 1), so it may never hide a first execution
// Google already answered.
describe('createSingle401RefreshExecutor dispatch evidence', () => {
  it('returns a first-attempt failure with its dispatch evidence', async () => {
    const failure: GoogleProviderExecutionResult = Object.freeze({
      ok: false,
      code: 'transport_error',
      dispatch: 'unknown',
      retryAfterMs: 0,
    })
    const { executor, execute } = refreshingExecutor([failure])

    await expect(executor.execute(DESCRIPTOR, OPTIONS)).resolves.toBe(failure)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('reports the answered 401 when the retry after refresh was never sent', async () => {
    const retried: GoogleProviderExecutionResult = Object.freeze({
      ok: false,
      code: 'admission_denied',
      admissionCode: 'quota_exhausted',
      dispatch: 'not_sent',
      retryAfterMs: 5_000,
    })
    const { executor, execute } = refreshingExecutor([unauthorized(), retried])

    await expect(executor.execute(DESCRIPTOR, OPTIONS)).resolves.toEqual({
      ok: false,
      code: 'admission_denied',
      admissionCode: 'quota_exhausted',
      dispatch: 'answered',
      providerStatus: 401,
      retryAfterMs: 5_000,
    })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      accessToken: 'fresh-access-token',
    })
  })

  it('keeps unknown evidence from a retry that may have reached Google', async () => {
    const retried: GoogleProviderExecutionResult = Object.freeze({
      ok: false,
      code: 'transport_error',
      dispatch: 'unknown',
      retryAfterMs: 0,
    })
    const { executor } = refreshingExecutor([unauthorized(), retried])

    await expect(executor.execute(DESCRIPTOR, OPTIONS)).resolves.toBe(retried)
  })

  it('returns an answered retry failure with its provider status', async () => {
    const retried: GoogleProviderExecutionResult = Object.freeze({
      ok: false,
      code: 'response_too_large',
      dispatch: 'answered',
      providerStatus: 200,
      retryAfterMs: 0,
    })
    const { executor } = refreshingExecutor([unauthorized(), retried])

    await expect(executor.execute(DESCRIPTOR, OPTIONS)).resolves.toBe(retried)
  })
})

// Google answers 401 at once when it revokes a grant, and the forced refresh is
// then refused for good. The answered 401 is the whole outcome. Throwing
// instead made the caller read a refused reply as an unknown dispatch: the
// reply stayed "sending" and went onto the 72-hour read ladder.
describe('createSingle401RefreshExecutor after Google refused the grant', () => {
  function afterRefreshFailure(refreshFailure: Error) {
    const first = unauthorized()
    const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(async () => first)
    const reauthorize = vi.fn(
      async ({ authorization }: { authorization: GoogleProviderCallAuthorization }) =>
        authorization,
    )
    const executor = createSingle401RefreshExecutor({
      executor: { execute },
      refreshAccessToken: async () => {
        throw refreshFailure
      },
      getAccessToken: async () => 'unused-access-token',
      reauthorize,
    })
    return { executor, execute, reauthorize, first }
  }

  it('returns the answered 401 once the grant needs reauthorization', async () => {
    const { executor, execute, reauthorize, first } = afterRefreshFailure(
      integrationError(
        'reauthorization_required',
        'Google connection requires reauthorization',
      ),
    )

    const result = await executor.execute(DESCRIPTOR, OPTIONS)

    expect(result).toMatchObject({ ok: true, status: 401 })
    expect(result).toBe(first)
    expect([...first.body].every((byte) => byte === 0)).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(reauthorize).not.toHaveBeenCalled()
  })

  it('still fails a refresh that Google may accept later', async () => {
    const refreshFailure = integrationError(
      'token_refresh_failed',
      'Google credential provider is unavailable',
    )
    const { executor } = afterRefreshFailure(refreshFailure)

    await expect(executor.execute(DESCRIPTOR, OPTIONS)).rejects.toBe(refreshFailure)
  })
})
