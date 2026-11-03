import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { renderQrPreviewDataUrl } from '#/components/features/portal/portal-share/portal-qr'
import { staffSelfKeys } from '#/shared/queries/query-keys'
import type { StaffHomeFns } from './types'

export function useStaffCode(
  read: StaffHomeFns['getMyCode'],
  participationId: string,
  paused: boolean,
) {
  const client = useQueryClient()
  useEffect(() => {
    if (paused) {
      void client.cancelQueries({ queryKey: staffSelfKeys.code(participationId) })
      client.setQueryData(staffSelfKeys.code(participationId), { state: 'paused' })
    }
  }, [client, participationId, paused])
  const code = useQuery({
    queryKey: staffSelfKeys.code(participationId),
    queryFn: async () => {
      const answer = await read({ data: { participationId } })
      return answer.state === 'live'
        ? { ...answer, preview: await renderQrPreviewDataUrl(answer.qr) }
        : answer
    },
    staleTime: 0,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: 'always',
    enabled: !paused,
  })
  const { refetch } = code
  useEffect(() => {
    const refresh = () => {
      if (!paused) void refetch({ cancelRefetch: false })
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refetch, paused])
  return code
}
