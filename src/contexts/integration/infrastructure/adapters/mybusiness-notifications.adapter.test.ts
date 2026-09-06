import { describe, expect, it, vi } from 'vitest'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import type { GoogleProviderRouteDescriptor } from '#/shared/google-provider-control/route-catalogue'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderExecutionResult,
} from '../../application/ports/google-authorized-provider-executor.port'
import { createMyBusinessNotificationsAdapter } from './mybusiness-notifications.adapter'

const NOW_MS = 1_800_000_000_000
const AUTHORIZATION: GoogleProviderCallAuthorization = Object.freeze({
  capability: 'property.connect_gbp',
  organizationId: organizationId('org-1'),
  propertyId: propertyId('11111111-1111-4111-8111-111111111111'),
  connectionId: googleConnectionId('22222222-2222-4222-8222-222222222222'),
  initiatorUserId: null,
  expectedCredentialGeneration: 6,
  authorizationVector: Object.freeze({ credentialGeneration: 6 }),
})

function providerJson(value: unknown, status = 200): GoogleProviderExecutionResult {
  return {
    ok: true,
    status,
    headers: {
      contentType: 'application/json; charset=utf-8',
      cacheControl: null,
      retryAfter: null,
    },
    body: new TextEncoder().encode(JSON.stringify(value)),
  }
}

function setup(results: readonly GoogleProviderExecutionResult[]) {
  const descriptors: GoogleProviderRouteDescriptor[] = []
  const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(
    async (descriptor, options) => {
      descriptors.push(descriptor)
      expect(options.authorization).toBe(AUTHORIZATION)
      const result = results[descriptors.length - 1]
      if (!result) throw new Error('unexpected provider call')
      return result
    },
  )
  const adapter = createMyBusinessNotificationsAdapter({
    executor: { execute },
    nowMs: () => NOW_MS,
  })
  return { adapter, execute, descriptors }
}

const setting = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  name: 'accounts/account-1/notificationSetting',
  pubsubTopic: 'projects/repkey-project/topics/gbp-reviews',
  notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'],
  ...overrides,
})

describe('createMyBusinessNotificationsAdapter', () => {
  it('subscribes only through the frozen write route and confirms exact desired state', async () => {
    const harness = setup([providerJson(setting()), providerJson(setting())])

    await harness.adapter.subscribe({
      accessToken: 'access-token',
      authorization: AUTHORIZATION,
      gbpAccountId: 'account-1',
      pubsubTopic: 'projects/repkey-project/topics/gbp-reviews',
      notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'],
    })

    expect(harness.descriptors).toEqual([
      {
        routeKey: 'notifications.subscribe',
        accessToken: 'access-token',
        accountId: 'account-1',
        pubsubTopic: 'projects/repkey-project/topics/gbp-reviews',
        notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'],
      },
      {
        routeKey: 'notifications.get',
        accessToken: 'access-token',
        accountId: 'account-1',
      },
    ])
  })

  it('unsubscribes through the frozen route and accepts an omitted empty topic on readback', async () => {
    const harness = setup([
      providerJson(setting({ pubsubTopic: '', notificationTypes: [] })),
      providerJson({
        name: 'accounts/account-1/notificationSetting',
        notificationTypes: [],
      }),
    ])

    await harness.adapter.unsubscribe({
      accessToken: 'access-token',
      authorization: AUTHORIZATION,
      gbpAccountId: 'account-1',
    })

    expect(harness.descriptors.map((descriptor) => descriptor.routeKey)).toEqual([
      'notifications.unsubscribe',
      'notifications.get',
    ])
  })

  it('reconciles an ambiguous subscribe by readback without repeating the write', async () => {
    const harness = setup([
      { ok: false, code: 'transport_error', retryAfterMs: 0 },
      providerJson(setting()),
    ])

    await harness.adapter.subscribe({
      accessToken: 'access-token',
      authorization: AUTHORIZATION,
      gbpAccountId: 'account-1',
      pubsubTopic: 'projects/repkey-project/topics/gbp-reviews',
      notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'],
    })

    expect(harness.descriptors.map((descriptor) => descriptor.routeKey)).toEqual([
      'notifications.subscribe',
      'notifications.get',
    ])
  })

  it('preserves an ambiguous outcome when authoritative readback does not match', async () => {
    const harness = setup([
      { ok: false, code: 'transport_error', retryAfterMs: 0 },
      providerJson(setting({ pubsubTopic: 'projects/other/topics/topic' })),
    ])

    await expect(
      harness.adapter.subscribe({
        accessToken: 'access-token',
        authorization: AUTHORIZATION,
        gbpAccountId: 'account-1',
        pubsubTopic: 'projects/repkey-project/topics/gbp-reviews',
        notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'],
      }),
    ).rejects.toMatchObject({
      _tag: 'GbpApiError',
      operation: 'subscribe',
      kind: 'upstream_error',
    })
    expect(harness.descriptors.map((descriptor) => descriptor.routeKey)).toEqual([
      'notifications.subscribe',
      'notifications.get',
    ])
  })

  it('does not read back or retry a provider-authoritative permission rejection', async () => {
    const harness = setup([providerJson({ error: 'forbidden' }, 403)])

    await expect(
      harness.adapter.unsubscribe({
        accessToken: 'access-token',
        authorization: AUTHORIZATION,
        gbpAccountId: 'account-1',
      }),
    ).rejects.toMatchObject({ kind: 'permission_denied' })
    expect(harness.descriptors.map((descriptor) => descriptor.routeKey)).toEqual([
      'notifications.unsubscribe',
    ])
  })

  it('fails closed on malformed readback instead of claiming subscription', async () => {
    const harness = setup([
      providerJson(setting()),
      providerJson({ name: 'accounts/another-account/notificationSetting' }),
    ])

    await expect(
      harness.adapter.subscribe({
        accessToken: 'access-token',
        authorization: AUTHORIZATION,
        gbpAccountId: 'account-1',
        pubsubTopic: 'projects/repkey-project/topics/gbp-reviews',
        notificationTypes: ['NEW_REVIEW'],
      }),
    ).rejects.toMatchObject({ kind: 'parse_error' })
  })
})
