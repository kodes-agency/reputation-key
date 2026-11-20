import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { inboxCachePolicy } from './inbox-cache-policy'
import type { InboxServerFns } from './types'

type InboxVisitStampInput = Readonly<{
  organizationId: string | undefined
  enabled: boolean
  hasLoadedSuccessfully: boolean
  responseCutoff: Date | null
  stampLastInboxView: InboxServerFns['stampLastInboxView']
}>

/** Stamps one stable list cutoff per organization after its first successful load. */
export function useInboxVisitStamp({
  organizationId,
  enabled,
  hasLoadedSuccessfully,
  responseCutoff,
  stampLastInboxView,
}: InboxVisitStampInput): void {
  const queryClient = useQueryClient()
  const stampedOrganization = useRef<string | null>(null)
  const stampingOrganization = useRef<string | null>(null)
  const { mutate: stampVisit } = useMutation({
    mutationFn: (cutoff: Date) =>
      stampLastInboxView({ data: { responseCutoff: cutoff } }),
    onSuccess: () => inboxCachePolicy.onInboxVisited(queryClient),
    retry: 2,
  })

  useEffect(() => {
    if (
      !enabled ||
      !organizationId ||
      !hasLoadedSuccessfully ||
      responseCutoff === null ||
      stampedOrganization.current === organizationId ||
      stampingOrganization.current === organizationId
    ) {
      return
    }

    stampingOrganization.current = organizationId
    stampVisit(responseCutoff, {
      onSuccess: () => {
        stampedOrganization.current = organizationId
      },
      onSettled: () => {
        if (stampingOrganization.current === organizationId) {
          stampingOrganization.current = null
        }
      },
    })
  }, [enabled, hasLoadedSuccessfully, organizationId, responseCutoff, stampVisit])
}
