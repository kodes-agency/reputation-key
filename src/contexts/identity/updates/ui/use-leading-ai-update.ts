import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { merchantAiNoticeUpdateQuery } from '#/components/features/settings/merchant-ai-notice-update-query'
import type { MerchantAiNoticeUpdateScope } from '#/components/features/settings/merchant-ai-notice-update-query'
import { useMarkMerchantAiNoticeUpdateSeen } from '#/components/features/settings/use-mark-merchant-ai-notice-update-seen'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { ProductUpdatesClientGetter } from '#/shared/whats-new/types'

/**
 * The pending AI update an AccountAdmin is told first, in the cache entry the
 * settings banner reads too. Anyone else reads nothing (the server would refuse):
 * `settled` is then true at once, so the modal never waits for a read that is not
 * coming. A read that fails settles as no update, and the banner stays the way in.
 */
export function useLeadingAiUpdate(
  scope: MerchantAiNoticeUpdateScope,
  getClient: ProductUpdatesClientGetter,
) {
  const { can, role } = usePermissions()
  const mayRead = can('ai.manage') && role === 'AccountAdmin'
  const getAiClient = useCallback(
    async () => (await getClient()).aiNoticeUpdate,
    [getClient],
  )
  const query = useQuery({
    ...merchantAiNoticeUpdateQuery(scope, getAiClient),
    enabled: mayRead,
    // The banner beside the shell polls this same entry; one timer is enough.
    refetchInterval: false,
  })
  const markSeen = useMarkMerchantAiNoticeUpdateSeen(scope, getAiClient)
  return {
    update: mayRead ? (query.data ?? null) : null,
    settled: !mayRead || !query.isPending,
    markSeen,
  }
}
