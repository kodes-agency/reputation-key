import { useQueryClient } from '@tanstack/react-query'
import {
  useActionMutation,
  actionFailureMessage,
} from '#/components/hooks/use-action-mutation'
import { identityKeys } from '#/shared/queries/query-keys'
import type {
  MerchantAiNoticeUpdate,
  MerchantAiNoticeUpdateClientGetter,
} from '#/shared/merchant-ai-notice-announcements'
import {
  merchantAiNoticeUpdateKey,
  type MerchantAiNoticeUpdateScope,
} from './merchant-ai-notice-update-query'

/**
 * Records that the person has seen the update, once for every place that shows
 * it: the server keeps the receipt and the shared cache entry empties, so the
 * settings banner goes the moment What's new (or the banner itself) marks it.
 */
export function useMarkMerchantAiNoticeUpdateSeen(
  scope: MerchantAiNoticeUpdateScope,
  getClient: MerchantAiNoticeUpdateClientGetter,
) {
  const client = useQueryClient()
  return useActionMutation(
    async (update: MerchantAiNoticeUpdate) => {
      await (
        await getClient()
      ).markSeen({
        data: { noticeVersion: update.noticeVersion, noticeDigest: update.noticeDigest },
      })
    },
    {
      invalidateKeys: [identityKeys.merchantAiOverview()],
      onSuccess: () => {
        client.setQueryData(merchantAiNoticeUpdateKey(scope), null)
      },
      errorMessage: actionFailureMessage("Couldn't mark this AI update as seen."),
    },
  )
}
