import { describe, expect, it, vi } from 'vitest'
import { isGbpApiError } from '../../domain/gbp-api-error'
import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'
import { createGoogleAccountManagementAdapter } from './google-account-management.adapter'
import { createGoogleBusinessInformationAdapter } from './google-business-information.adapter'
import { createSingle401RefreshExecutor } from './google-single-401-refresh-executor'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const authorization = Object.freeze({
  capability: 'property.import_gbp_v2' as const,
  organizationId: organizationId('11111111-1111-4111-8111-111111111111'),
  propertyId: null,
  connectionId: googleConnectionId('22222222-2222-4222-8222-222222222222'),
  initiatorUserId: 'user-1',
  approvalBindingId: '33333333-3333-4333-8333-333333333333',
  authorizationVector: Object.freeze({ policyVersion: 1 }),
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
          name: 'accounts/account-1',
          accountName: 'Acme Group',
          role: 'PRIMARY_OWNER',
          type: 'PERSONAL',
        },
        {
          name: 'accounts/account-2',
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
          resourceName: 'accounts/account-1',
          accountId: 'account-1',
          displayName: 'Acme Group',
          role: 'primary_owner',
        },
        {
          resourceName: 'accounts/account-2',
          accountId: 'account-2',
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
      { authorization, deadlineMs: 15_000, signal },
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
    const refreshAccessToken = vi.fn(async () => 'refreshed-access-token')
    const adapter = createGoogleAccountManagementAdapter({
      executor: createSingle401RefreshExecutor({
        executor: { execute },
        refreshAccessToken,
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
    expect(execute).toHaveBeenNthCalledWith(
      1,
      {
        routeKey: 'account-management.accounts.list',
        accessToken: 'expired-access-token',
      },
      { authorization, deadlineMs: 16_000 },
    )
    expect(execute).toHaveBeenNthCalledWith(
      2,
      {
        routeKey: 'account-management.accounts.list',
        accessToken: 'refreshed-access-token',
      },
      { authorization, deadlineMs: 16_000 },
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
      { authorization, deadlineMs: 15_000, signal },
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

    const deniedExecutor: GoogleAuthorizedProviderExecutor = {
      execute: async () => ({
        ok: false,
        code: 'admission_denied',
        retryAfterMs: 9_000,
      }),
    }
    await expect(
      createGoogleBusinessInformationAdapter({ executor: deniedExecutor }).listLocations({
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
  })
})
