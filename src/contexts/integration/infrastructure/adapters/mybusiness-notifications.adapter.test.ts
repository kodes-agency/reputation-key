// Integration context — My Business Notifications adapter tests (Pub/Sub lifecycle step 2).
// Verifies the load-bearing HTTP contract with Google's updateNotificationSetting endpoint:
// PATCH URL shape, Bearer auth header, request body, and HTTP-status → error-kind mapping.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMyBusinessNotificationsAdapter } from './mybusiness-notifications.adapter'

const ok = () => ({ ok: true, status: 200, text: () => Promise.resolve('{}') })

// BQC-4.3: the adapter receives its base URL via construction config (tests
// pass the production endpoint explicitly, as the composition mapping does).
const BASE_URL = 'https://mybusinessnotifications.googleapis.com/v1'

describe('createMyBusinessNotificationsAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // updateMask is a REQUIRED query parameter on updateNotificationSetting:
  // without it Google answers 400 INVALID_ARGUMENT and no account is ever
  // subscribed, however well the topic is configured.
  it('subscribe PATCHes updateNotificationSetting with the required updateMask, topic, types, and bearer token', async () => {
    fetchMock.mockResolvedValueOnce(ok())
    const adapter = createMyBusinessNotificationsAdapter({ baseUrl: BASE_URL })

    await adapter.subscribe({
      accessToken: 'tok',
      gbpAccountId: '123',
      pubsubTopic: 'projects/p/topics/t',
      notificationTypes: ['NEW_REVIEW'],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://mybusinessnotifications.googleapis.com/v1/accounts/123/notificationSetting?updateMask=pubsubTopic,notificationTypes',
    )
    expect(init.method).toBe('PATCH')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: 'accounts/123/notificationSetting',
      pubsubTopic: 'projects/p/topics/t',
      notificationTypes: ['NEW_REVIEW'],
    })
  })

  it('unsubscribe PATCHes with updateMask=pubsubTopic and an empty topic', async () => {
    fetchMock.mockResolvedValueOnce(ok())
    const adapter = createMyBusinessNotificationsAdapter({ baseUrl: BASE_URL })

    await adapter.unsubscribe({ accessToken: 'tok', gbpAccountId: '123' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://mybusinessnotifications.googleapis.com/v1/accounts/123/notificationSetting?updateMask=pubsubTopic',
    )
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' })
    expect(JSON.parse(init.body as string).pubsubTopic).toBe('')
  })

  it('classifies a 401 as auth_failed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('unauth'),
    })
    const adapter = createMyBusinessNotificationsAdapter({ baseUrl: BASE_URL })

    await expect(
      adapter.subscribe({
        accessToken: 'tok',
        gbpAccountId: '1',
        pubsubTopic: 't',
        notificationTypes: [],
      }),
    ).rejects.toMatchObject({ _tag: 'GbpApiError', kind: 'auth_failed' })
  })

  it('classifies a 429 as rate_limited', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve('slow'),
    })
    const adapter = createMyBusinessNotificationsAdapter({ baseUrl: BASE_URL })

    await expect(
      adapter.unsubscribe({ accessToken: 'tok', gbpAccountId: '1' }),
    ).rejects.toMatchObject({ kind: 'rate_limited' })
  })

  // Same hole as gbp-api.adapter had: an unreachable provider never yields a
  // Response, fetch rejects with a raw TypeError, and without classification it
  // escapes the taxonomy — `_tag` absent, and the logged diagnostic reduced by
  // safeError() to an unattributable `TypeError`.
  it.each(['subscribe', 'unsubscribe'] as const)(
    'classifies an unreachable provider on %s as a governed upstream_error',
    async (operation) => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
      const adapter = createMyBusinessNotificationsAdapter({ baseUrl: BASE_URL })

      const call =
        operation === 'subscribe'
          ? adapter.subscribe({
              accessToken: 'tok',
              gbpAccountId: '1',
              pubsubTopic: 't',
              notificationTypes: [],
            })
          : adapter.unsubscribe({ accessToken: 'tok', gbpAccountId: '1' })

      await expect(call).rejects.toMatchObject({
        _tag: 'GbpApiError',
        name: 'GbpApiError',
        operation,
        kind: 'upstream_error',
      })
    },
  )

  it('checks the credential boundary before notification subscription sockets', async () => {
    const refusal = new Error('credential gateway required')
    const assertDirectCredentialEgressAllowed = vi.fn(() => {
      throw refusal
    })
    const adapter = createMyBusinessNotificationsAdapter({
      baseUrl: BASE_URL,
      assertDirectCredentialEgressAllowed,
    })

    await expect(
      adapter.subscribe({
        accessToken: 'tok',
        gbpAccountId: '1',
        pubsubTopic: 't',
        notificationTypes: [],
      }),
    ).rejects.toBe(refusal)
    await expect(
      adapter.unsubscribe({ accessToken: 'tok', gbpAccountId: '1' }),
    ).rejects.toBe(refusal)
    expect(assertDirectCredentialEgressAllowed.mock.calls).toEqual([
      ['notifications.subscribe'],
      ['notifications.unsubscribe'],
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
