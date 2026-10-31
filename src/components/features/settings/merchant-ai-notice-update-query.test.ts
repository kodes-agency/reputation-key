import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { identityKeys } from '#/shared/queries/query-keys'
import { MERCHANT_AI_NOTICE_ANNOUNCEMENTS } from '#/shared/merchant-ai-notice-announcements'
import type { MerchantAiNoticeUpdate } from '#/shared/merchant-ai-notice-announcements'
import {
  merchantAiNoticeUpdateKey,
  merchantAiNoticeUpdateQuery,
} from './merchant-ai-notice-update-query'

const scope = { userId: 'user-1', organizationId: 'org-1' }
const update: MerchantAiNoticeUpdate = {
  ...MERCHANT_AI_NOTICE_ANNOUNCEMENTS['merchant-ai-notice-2026-10-30.v1']!,
  noticeVersion: 'merchant-ai-notice-2026-10-30.v1',
  noticeDigest: 'a'.repeat(64),
  renewedAt: '2026-10-31T09:00:00.000Z',
}
const clientOf = (get: () => Promise<MerchantAiNoticeUpdate | null>) => ({
  get,
  markSeen: vi.fn(async () => {}),
})

describe('the pending AI update query', () => {
  it('is kept per person and Organization, under the AI notice key', () => {
    // The AI overview invalidates the `updates` prefix when it marks an update seen.
    expect(merchantAiNoticeUpdateKey(scope)).toEqual([
      ...identityKeys.merchantAiNotice(),
      'updates',
      'user-1',
      'org-1',
    ])
    expect(merchantAiNoticeUpdateKey({ ...scope, organizationId: 'org-2' })).not.toEqual(
      merchantAiNoticeUpdateKey(scope),
    )
  })

  it('is fresh for a minute and polled every five', () => {
    const options = merchantAiNoticeUpdateQuery(scope, async () =>
      clientOf(async () => null),
    )
    expect(options.staleTime).toBe(60_000)
    expect(options.refetchInterval).toBe(300_000)
  })

  it('reads through the client it is given, only when it runs', async () => {
    const get = vi.fn(async () => update)
    const getClient = vi.fn(async () => clientOf(get))
    const options = merchantAiNoticeUpdateQuery(scope, getClient)
    expect(getClient).not.toHaveBeenCalled()
    expect(await new QueryClient().fetchQuery(options)).toEqual(update)
    expect(get).toHaveBeenCalledOnce()
  })

  it('is one cache entry for every reader: emptying it empties the banner too', () => {
    const cache = new QueryClient()
    const forBanner = merchantAiNoticeUpdateQuery(scope, async () =>
      clientOf(async () => update),
    )
    const forWhatsNew = merchantAiNoticeUpdateQuery(scope, async () =>
      clientOf(async () => update),
    )
    cache.setQueryData(forBanner.queryKey, update)
    expect(cache.getQueryData(forWhatsNew.queryKey)).toEqual(update)
    cache.setQueryData(forWhatsNew.queryKey, null)
    expect(cache.getQueryData(forBanner.queryKey)).toBeNull()
  })
})
