import {
  GOOGLE_ACCOUNT_PRIMARY_RESOURCE,
  GOOGLE_PROVIDER_FIXTURES_V1,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, expect, it, vi } from 'vitest'
import { isGbpApiError } from '../../domain/gbp-api-error'
import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'
import { createGoogleAccountManagementAdapter } from './google-account-management.adapter'
import { createGoogleBusinessInformationAdapter } from './google-business-information.adapter'
import { createSingle401RefreshExecutor } from './google-single-401-refresh-executor'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'

const PRIMARY_ACCOUNT_ID =
  GOOGLE_PROVIDER_FIXTURES_V1['google-account-primary'].expectedSegments.accountId
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const authorization = Object.freeze({
  capability: 'property.import_gbp_v2' as const,
  organizationId: organizationId('11111111-1111-4111-8111-111111111111'),
  propertyId: null,
  connectionId: googleConnectionId('22222222-2222-4222-8222-222222222222'),
  initiatorUserId: 'user-1',
  approvalBindingId: '33333333-3333-4333-8333-333333333333',
  expectedCredentialGeneration: 3,
  authorizationVector: Object.freeze({ policyVersion: 1 }),
})
const reauthorized = Object.freeze({
  ...authorization,
  expectedCredentialGeneration: 4,
  authorizationVector: Object.freeze({ policyVersion: 2 }),
})

function executorReturning(value: unknown, status = 200) {
  const execute: GoogleAuthorizedProviderExecutor['execute'] = vi.fn(async () => ({
    ok: true as const,
    status,
    headers: Object.freeze({
      contentType: 'application/json; charset=UTF-8',
      cacheControl: 'private',
      retryAfter: null,
    }),
    body: jsonBytes(value),
  }))
  return { execute }
}

describe('Google Account Management adapter', () => {
  it('sends one frozen page request and parses documented account fields', async () => {
    const executor = executorReturning({
      accounts: [
        {
          name: GOOGLE_ACCOUNT_PRIMARY_RESOURCE,
          accountName: 'Acme Group',
          role: 'PRIMARY_OWNER',
          type: 'PERSONAL',
        },
        {
          name: `${GOOGLE_ACCOUNT_PRIMARY_RESOURCE}-secondary`,
          accountName: 'Second Group',
          role: 'FUTURE_ROLE',
        },
      ],
      nextPageToken: 'next-account-page',
      ignoredAdditiveField: true,
    })
    const signal = new AbortController().signal
    const adapter = createGoogleAccountManagementAdapter({
      executor,
      nowMs: () => 0,
    })

    await expect(
      adapter.listAccounts({
        accessToken: 'access-token',
        authorization,
        pageToken: 'account-page-token',
        signal,
      }),
    ).resolves.toEqual({
      items: [
        {
          resourceName: GOOGLE_ACCOUNT_PRIMARY_RESOURCE,
          accountId: PRIMARY_ACCOUNT_ID,
          displayName: 'Acme Group',
          role: 'primary_owner',
        },
        {
          resourceName: `${GOOGLE_ACCOUNT_PRIMARY_RESOURCE}-secondary`,
          accountId: `${PRIMARY_ACCOUNT_ID}-secondary`,
          displayName: 'Second Group',
          role: 'unknown',
        },
      ],
      nextPageToken: 'next-account-page',
    })
    expect(executor.execute).toHaveBeenCalledWith(
      {
        routeKey: 'account-management.accounts.list',
        accessToken: 'access-token',
        pageToken: 'account-page-token',
      },
      { authorization, deadlineMs: 15_000, signal: expect.any(AbortSignal) },
    )
  })

  it('fails the whole page closed on malformed account names or response JSON', async () => {
    const malformedName = createGoogleAccountManagementAdapter({
      executor: executorReturning({
        accounts: [{ name: 'accounts/a/extra', accountName: 'Unsafe', role: 'OWNER' }],
      }),
    })
    await expect(
      malformedName.listAccounts({ accessToken: 'token', authorization }),
    ).rejects.toSatisfy(
      (error: unknown) => isGbpApiError(error) && error.kind === 'parse_error',
    )

    const malformedJsonExecutor: GoogleAuthorizedProviderExecutor = {
      execute: async () => ({
        ok: true,
        status: 200,
        headers: {
          contentType: 'application/json',
          cacheControl: null,
          retryAfter: null,
        },
        body: new TextEncoder().encode('{'),
      }),
    }
    await expect(
      createGoogleAccountManagementAdapter({
        executor: malformedJsonExecutor,
      }).listAccounts({
        accessToken: 'token',
        authorization,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isGbpApiError(error) && error.kind === 'parse_error',
    )
  })

  it('reacquires execution for one refreshed 401 retry and never retries twice', async () => {
    const execute = vi
      .fn<GoogleAuthorizedProviderExecutor['execute']>()
      .mockResolvedValueOnce({
        ok: true,
        status: 401,
        headers: {
          contentType: 'application/json',
          cacheControl: 'private',
          retryAfter: null,
        },
        body: jsonBytes({ error: 'expired' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          contentType: 'application/json',
          cacheControl: 'private',
          retryAfter: null,
        },
        body: jsonBytes({ accounts: [] }),
      })
    const refreshAccessToken = vi.fn(async () => 'leader-only-token')
    const getAccessToken = vi.fn(async () => 'refreshed-access-token')
    const reauthorize = vi.fn(async () => reauthorized)
    const adapter = createGoogleAccountManagementAdapter({
      executor: createSingle401RefreshExecutor({
        executor: { execute },
        refreshAccessToken,
        getAccessToken,
        reauthorize,
      }),
      nowMs: () => 1_000,
    })

    await expect(
      adapter.listAccounts({
        accessToken: 'expired-access-token',
        authorization,
      }),
    ).resolves.toEqual({ items: [], nextPageToken: null })
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(getAccessToken).toHaveBeenCalledTimes(1)
    expect(reauthorize).toHaveBeenCalledWith({ authorization })
    expect(reauthorize.mock.invocationCallOrder[0]).toBeLessThan(
      getAccessToken.mock.invocationCallOrder[0]!,
    )
    expect(getAccessToken).toHaveBeenCalledWith({ authorization: reauthorized })
    expect(execute).toHaveBeenNthCalledWith(
      1,
      {
        routeKey: 'account-management.accounts.list',
        accessToken: 'expired-access-token',
      },
      { authorization, deadlineMs: 16_000, signal: expect.any(AbortSignal) },
    )
    expect(execute).toHaveBeenNthCalledWith(
      2,
      {
        routeKey: 'account-management.accounts.list',
        accessToken: 'refreshed-access-token',
      },
      {
        authorization: reauthorized,
        deadlineMs: 16_000,
        signal: expect.any(AbortSignal),
      },
    )

    execute.mockClear()
    execute.mockResolvedValue({
      ok: true,
      status: 401,
      headers: {
        contentType: 'application/json',
        cacheControl: 'private',
        retryAfter: null,
      },
      body: jsonBytes({ error: 'still-expired' }),
    })
    await expect(
      adapter.listAccounts({
        accessToken: 'expired-again',
        authorization,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isGbpApiError(error) && error.kind === 'auth_failed',
    )
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('shares one refresh leader per connection while every caller reacquires execution', async () => {
    let releaseRefresh: ((value: string) => void) | undefined
    const refreshAccessToken = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseRefresh = resolve
        }),
    )
    const getAccessToken = vi.fn(async () => 'shared-access-token')
    const reauthorize = vi.fn(async () => reauthorized)
    const firstBodies = [
      jsonBytes({ error: 'expired-1' }),
      jsonBytes({ error: 'expired-2' }),
    ]
    const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(
      async (descriptor) => {
        if (
          !('accessToken' in descriptor) ||
          descriptor.accessToken !== 'shared-access-token'
        ) {
          return {
            ok: true,
            status: 401,
            headers: {
              contentType: 'application/json',
              cacheControl: 'private',
              retryAfter: null,
            },
            body: firstBodies.shift()!,
          }
        }
        return {
          ok: true,
          status: 200,
          headers: {
            contentType: 'application/json',
            cacheControl: 'private',
            retryAfter: null,
          },
          body: jsonBytes({ accounts: [] }),
        }
      },
    )
    const adapter = createGoogleAccountManagementAdapter({
      executor: createSingle401RefreshExecutor({
        executor: { execute },
        refreshAccessToken,
        getAccessToken,
        reauthorize,
      }),
      nowMs: () => 1_000,
    })

    const first = adapter.listAccounts({
      accessToken: 'expired-access-token-1',
      authorization,
    })
    const second = adapter.listAccounts({
      accessToken: 'expired-access-token-2',
      authorization,
    })
    await vi.waitFor(() => expect(refreshAccessToken).toHaveBeenCalledTimes(1))
    releaseRefresh?.('leader-only-token')

    await expect(Promise.all([first, second])).resolves.toEqual([
      { items: [], nextPageToken: null },
      { items: [], nextPageToken: null },
    ])
    expect(execute).toHaveBeenCalledTimes(4)
    expect(
      execute.mock.calls
        .slice(2)
        .map(([descriptor]) =>
          'accessToken' in descriptor ? descriptor.accessToken : null,
        ),
    ).toEqual(['shared-access-token', 'shared-access-token'])
    expect(getAccessToken).toHaveBeenCalledTimes(2)
    expect(reauthorize).toHaveBeenCalledTimes(2)
    expect(
      execute.mock.calls.slice(2).map(([, options]) => options.authorization),
    ).toEqual([reauthorized, reauthorized])
  })

  it('stops an aborted caller waiting on shared refresh without retrying', async () => {
    const expiredBody = jsonBytes({ error: 'expired' })
    const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(async () => ({
      ok: true,
      status: 401,
      headers: {
        contentType: 'application/json',
        cacheControl: 'private',
        retryAfter: null,
      },
      body: expiredBody,
    }))
    let releaseRefresh: (() => void) | undefined
    const refreshAccessToken = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseRefresh = resolve
        }),
    )
    const getAccessToken = vi.fn(async () => 'unused-access-token')
    const reauthorize = vi.fn(async () => reauthorized)
    const adapter = createGoogleAccountManagementAdapter({
      executor: createSingle401RefreshExecutor({
        executor: { execute },
        refreshAccessToken,
        getAccessToken,
        reauthorize,
      }),
      nowMs: () => 1_000,
    })
    const controller = new AbortController()

    const request = adapter.listAccounts({
      accessToken: 'expired-access-token',
      authorization,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(refreshAccessToken).toHaveBeenCalledOnce())
    controller.abort(new DOMException('caller aborted', 'AbortError'))

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(expiredBody.every((byte) => byte === 0)).toBe(true)
    releaseRefresh?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(execute).toHaveBeenCalledOnce()
    expect(getAccessToken).not.toHaveBeenCalled()
    expect(reauthorize).not.toHaveBeenCalled()
  })

  it('returns on caller cancellation and overwrites a late provider body', async () => {
    let resolveExecution:
      | ((
          value: Awaited<ReturnType<GoogleAuthorizedProviderExecutor['execute']>>,
        ) => void)
      | undefined
    const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(
      () =>
        new Promise((resolve) => {
          resolveExecution = resolve
        }),
    )
    const controller = new AbortController()
    const adapter = createGoogleAccountManagementAdapter({
      executor: { execute },
      nowMs: () => 1_000,
    })

    const request = adapter.listAccounts({
      accessToken: 'access-token',
      authorization,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })

    const lateBody = jsonBytes({
      accounts: [{ name: `${GOOGLE_ACCOUNT_PRIMARY_RESOURCE}-late` }],
    })
    resolveExecution?.({
      ok: true,
      status: 200,
      headers: {
        contentType: 'application/json',
        cacheControl: 'private',
        retryAfter: null,
      },
      body: lateBody,
    })
    await vi.waitFor(() =>
      expect([...lateBody]).toEqual(new Array(lateBody.length).fill(0)),
    )
  })

  it('aborts an unresolved provider execution at the 15-second deadline', async () => {
    vi.useFakeTimers()
    try {
      let observedSignal: AbortSignal | undefined
      const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(
        (_descriptor, options) => {
          observedSignal = options.signal
          return new Promise(() => undefined)
        },
      )
      const adapter = createGoogleAccountManagementAdapter({
        executor: { execute },
        nowMs: () => 1_000,
      })
      const result = adapter.listAccounts({
        accessToken: 'access-token',
        authorization,
      })
      const rejection = expect(result).rejects.toSatisfy(
        (error: unknown) => isGbpApiError(error) && error.kind === 'upstream_error',
      )

      await vi.advanceTimersByTimeAsync(15_000)

      await rejection
      expect(observedSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Google Business Information adapter', () => {
  it('preserves selected account identity and parses bare location resources', async () => {
    const executor = executorReturning({
      locations: [
        {
          name: 'locations/location-1',
          title: 'Acme Diner',
          storefrontAddress: {
            addressLines: ['123 Main Street', 'Suite 4'],
            locality: 'Sofia',
            administrativeArea: 'Sofia City',
            postalCode: '1000',
            regionCode: 'bg',
          },
          categories: {
            primaryCategory: { displayName: 'Restaurant' },
          },
        },
      ],
      nextPageToken: 'next-location-page',
    })
    const signal = new AbortController().signal
    const adapter = createGoogleBusinessInformationAdapter({
      executor,
      nowMs: () => 0,
    })

    await expect(
      adapter.listLocations({
        accessToken: 'access-token',
        authorization,
        accountId: 'account-1',
        accountDisplayName: 'Acme Group',
        pageToken: 'location-page-token',
        signal,
      }),
    ).resolves.toEqual({
      items: [
        {
          binding: { accountId: 'account-1', locationId: 'location-1' },
          accountDisplayName: 'Acme Group',
          businessName: 'Acme Diner',
          address: '123 Main Street, Suite 4, Sofia, Sofia City, 1000',
          primaryCategory: 'Restaurant',
          countryCode: 'BG',
        },
      ],
      nextPageToken: 'next-location-page',
    })
    expect(executor.execute).toHaveBeenCalledWith(
      {
        routeKey: 'business-information.locations.list',
        accessToken: 'access-token',
        accountId: 'account-1',
        pageToken: 'location-page-token',
      },
      { authorization, deadlineMs: 15_000, signal: expect.any(AbortSignal) },
    )
  })

  it.each(['bad/account', 'bad?account', 'bad#account', 'bad account'])(
    'rejects unsafe account suffix %s before executing',
    async (accountId) => {
      const executor = executorReturning({ locations: [] })
      const adapter = createGoogleBusinessInformationAdapter({ executor })
      await expect(
        adapter.listLocations({
          accessToken: 'token',
          authorization,
          accountId,
          accountDisplayName: 'Account',
        }),
      ).rejects.toSatisfy(
        (error: unknown) => isGbpApiError(error) && error.kind === 'parse_error',
      )
      expect(executor.execute).not.toHaveBeenCalled()
    },
  )

  it('classifies provider and gateway failures without retaining response content', async () => {
    const unauthorized = createGoogleBusinessInformationAdapter({
      executor: executorReturning({ providerHint: 'secret-provider-content' }, 401),
    })
    await expect(
      unauthorized.listLocations({
        accessToken: 'token',
        authorization,
        accountId: 'account-1',
        accountDisplayName: 'Account',
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isGbpApiError(error) &&
        error.kind === 'auth_failed' &&
        !JSON.stringify(error).includes('secret-provider-content'),
    )

    // Real provider quota pressure stays rate limiting…
    const quotaExhausted: GoogleAuthorizedProviderExecutor = {
      execute: async () => ({
        ok: false,
        code: 'admission_denied',
        admissionCode: 'quota_exhausted',
        retryAfterMs: 9_000,
      }),
    }
    await expect(
      createGoogleBusinessInformationAdapter({ executor: quotaExhausted }).listLocations({
        accessToken: 'token',
        authorization,
        accountId: 'account-1',
        accountDisplayName: 'Account',
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isGbpApiError(error) &&
        error.kind === 'rate_limited' &&
        error.retryAfterMs === 9_000,
    )

    // …while a permit/policy fence must not masquerade as provider throttling.
    const permitFenced: GoogleAuthorizedProviderExecutor = {
      execute: async () => ({
        ok: false,
        code: 'admission_denied',
        admissionCode: 'permit_expired',
        retryAfterMs: 0,
      }),
    }
    await expect(
      createGoogleBusinessInformationAdapter({ executor: permitFenced }).listLocations({
        accessToken: 'token',
        authorization,
        accountId: 'account-1',
        accountDisplayName: 'Account',
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isGbpApiError(error) && error.kind === 'upstream_error',
    )
  })
})
