import { useRouteContext } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MerchantAiNoticeUpdateBanner } from '#/components/features/settings/merchant-ai-notice-update-banner'
import {
  useActionMutation,
  actionFailureMessage,
} from '#/components/hooks/use-action-mutation'
import { identityKeys } from '#/shared/queries/query-keys'
import type { MerchantAiNoticeUpdate } from '#/shared/merchant-ai-notice-announcements'
import type { AuthRouteContext } from '#/routes/_authenticated'

/** Side read lives entirely in this lazy chunk, outside the shell's first paint. */
export default function MerchantAiNoticeUpdate() {
  const { user, activeOrganization, role } = useRouteContext({
    from: '/_authenticated',
  }) as AuthRouteContext
  return role === 'AccountAdmin' ? (
    <NoticeUpdateBody userId={user.id} organizationId={activeOrganization?.id ?? ''} />
  ) : null
}

function NoticeUpdateBody({
  userId,
  organizationId,
}: Readonly<{ userId: string; organizationId: string }>) {
  const queryKey = [
    ...identityKeys.merchantAiNotice(),
    'updates',
    userId,
    organizationId,
  ] as const
  const client = useQueryClient()
  const query = useQuery({
    queryKey,
    queryFn: async () =>
      (
        await import('#/contexts/identity/server/merchant-ai-notice-updates')
      ).getMerchantAiNoticeUpdateFn(),
    staleTime: 60_000,
    // An update appears only after a deploy; a few minutes' delay is fine.
    refetchInterval: 300_000,
  })
  const markSeen = useActionMutation(
    async (update: MerchantAiNoticeUpdate) => {
      const { markMerchantAiNoticeUpdateSeenFn } =
        await import('#/contexts/identity/server/merchant-ai-notice-updates')
      await markMerchantAiNoticeUpdateSeenFn({
        data: { noticeVersion: update.noticeVersion, noticeDigest: update.noticeDigest },
      })
    },
    {
      invalidateKeys: [identityKeys.merchantAiOverview()],
      onSuccess: () => {
        client.setQueryData(queryKey, null)
      },
      errorMessage: actionFailureMessage("Couldn't mark this AI update as seen."),
    },
  )
  return (
    <MerchantAiNoticeUpdateBanner
      key={`${userId}:${organizationId}`}
      update={query.data ?? null}
      markSeen={markSeen}
      pending={markSeen.isPending}
    />
  )
}
