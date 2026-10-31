import { queryOptions } from '@tanstack/react-query'
import { identityKeys } from '#/shared/queries/query-keys'
import type { MerchantAiNoticeUpdateClientGetter } from '#/shared/merchant-ai-notice-announcements'

/** Whose update it is: the cache is kept per person and Organization. */
export type MerchantAiNoticeUpdateScope = Readonly<{
  userId: string
  organizationId: string
}>

export const merchantAiNoticeUpdateKey = ({
  userId,
  organizationId,
}: MerchantAiNoticeUpdateScope) =>
  [...identityKeys.merchantAiNotice(), 'updates', userId, organizationId] as const

/**
 * An AccountAdmin's pending AI update (null once seen). The settings banner and
 * What's new read it through these options, so the two share one cache entry:
 * what one marks seen, the other stops showing. The server module reaches this
 * through `getClient`, handed down by the route layer.
 */
export const merchantAiNoticeUpdateQuery = (
  scope: MerchantAiNoticeUpdateScope,
  getClient: MerchantAiNoticeUpdateClientGetter,
) =>
  queryOptions({
    queryKey: merchantAiNoticeUpdateKey(scope),
    queryFn: async () => (await getClient()).get(),
    staleTime: 60_000,
    // An update appears only after a deploy; a few minutes' delay is fine.
    refetchInterval: 300_000,
  })
