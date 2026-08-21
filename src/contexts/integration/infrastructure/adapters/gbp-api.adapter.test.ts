// Integration context — GBP account-resolution adapter tests.
// Pins the boundary contract this adapter owes its callers: every failure that
// crosses out of listAccounts is classified in the GbpApiError taxonomy, HTTP
// statuses AND transport failures alike.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { createGbpApiAdapter } from './gbp-api.adapter'
import { isGbpApiError } from '../../domain/gbp-api-error'

const BASE_URL = 'https://mybusinessaccountmanagement.example.invalid/v1'

const page = (body: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
})

describe('createGbpApiAdapter.listAccounts', () => {
  let fetchMock: Mock

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the mapped accounts on a single page', async () => {
    fetchMock.mockResolvedValueOnce(
      page({ accounts: [{ name: 'accounts/123', accountName: 'Biz', role: 'OWNER' }] }),
    )

    await expect(
      createGbpApiAdapter({ baseUrl: BASE_URL }).listAccounts('tok'),
    ).resolves.toEqual([
      { name: 'accounts/123', accountName: '123', type: 'UNKNOWN', role: 'OWNER' },
    ])
  })

  // The beta fault smoke stops the provider container and asserts the operation
  // fails CLOSED. Under a real outage undici rejects fetch with a raw
  // `TypeError: fetch failed`, which is not in the taxonomy: `isGbpApiError` is
  // false, and safeError() strips the message so operators saw only
  // `{"error":{"name":"TypeError"}}` on a money-adjacent provider span.
  it('classifies an unreachable provider as a governed upstream_error, not a TypeError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const adapter = createGbpApiAdapter({ baseUrl: BASE_URL })

    const error: unknown = await adapter.listAccounts('tok').then(
      () => null,
      (thrown: unknown) => thrown,
    )

    expect(error).toBeInstanceOf(Error)
    expect(isGbpApiError(error)).toBe(true)
    expect(error).toMatchObject({
      name: 'GbpApiError',
      operation: 'listAccounts',
      kind: 'upstream_error',
    })
  })

  // Paging is where a transport failure is most likely: page 1 succeeds, the
  // provider drops, and the loop must still surface a classified error.
  it('classifies a transport failure on a later page too', async () => {
    fetchMock
      .mockResolvedValueOnce(
        page({
          accounts: [{ name: 'accounts/1', accountName: 'A' }],
          nextPageToken: 'p2',
        }),
      )
      .mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(
      createGbpApiAdapter({ baseUrl: BASE_URL }).listAccounts('tok'),
    ).rejects.toMatchObject({ name: 'GbpApiError', kind: 'upstream_error' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps classifying HTTP statuses at the boundary', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, body: null })

    await expect(
      createGbpApiAdapter({ baseUrl: BASE_URL }).listAccounts('tok'),
    ).rejects.toMatchObject({ name: 'GbpApiError', kind: 'auth_failed' })
  })
})
