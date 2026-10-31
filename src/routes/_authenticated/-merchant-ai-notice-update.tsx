import { useRouteContext } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { MerchantAiNoticeUpdateBanner } from '#/components/features/settings/merchant-ai-notice-update-banner'
import { merchantAiNoticeUpdateQuery } from '#/components/features/settings/merchant-ai-notice-update-query'
import { useMarkMerchantAiNoticeUpdateSeen } from '#/components/features/settings/use-mark-merchant-ai-notice-update-seen'
import type { MerchantAiNoticeUpdateClientGetter } from '#/shared/merchant-ai-notice-announcements'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { merchantAiNoticeUpdateClient } from './-merchant-ai-notice-update-client'

const getClient: MerchantAiNoticeUpdateClientGetter = async () =>
  merchantAiNoticeUpdateClient

/** Side read lives entirely in this lazy chunk, outside the shell's first paint. */
export default function MerchantAiNoticeUpdate() {
  const { user, activeOrganization, role } = useRouteContext({
    from: '/_authenticated',
  }) as AuthRouteContext
  return role === 'AccountAdmin' ? (
    <NoticeUpdateBody userId={user.id} organizationId={activeOrganization?.id ?? ''} />
  ) : null
}

/**
 * The slim banner is the fallback of the same update What's new leads with: both
 * read one cache entry, so whichever marks it seen empties the other.
 */
function NoticeUpdateBody({
  userId,
  organizationId,
}: Readonly<{ userId: string; organizationId: string }>) {
  const scope = { userId, organizationId }
  const query = useQuery(merchantAiNoticeUpdateQuery(scope, getClient))
  const markSeen = useMarkMerchantAiNoticeUpdateSeen(scope, getClient)
  return (
    <MerchantAiNoticeUpdateBanner
      key={`${userId}:${organizationId}`}
      update={query.data ?? null}
      markSeen={markSeen}
      pending={markSeen.isPending}
    />
  )
}
