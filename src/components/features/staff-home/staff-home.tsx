import { StaffHomeView } from './staff-home-view'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RegionError } from '#/components/ui/region-error'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { STAFF_NOTICE_VERSION } from '#/contexts/identity/application/public-api'
import { staffSelfKeys } from '#/shared/queries/query-keys'
import { useStaffRefusal } from './use-staff-refusal'
import { StaffNotice } from './staff-notice'
import type { StaffHomeData, StaffHomeFns, StaffHomeSearch } from './types'

export function ownStaffParticipation(home: StaffHomeData, id: string | undefined) {
  return (
    home.participations.find((row) => row.participationId === id) ??
    home.participations[0]
  )
}

export function StaffHome({
  home,
  userId,
  search,
  onSearch,
  fns,
  embedded = false,
}: Readonly<{
  userId: string
  home: StaffHomeData
  search: StaffHomeSearch
  onSearch: (search: StaffHomeSearch) => void
  fns: StaffHomeFns
  embedded?: boolean
}>) {
  const client = useQueryClient()
  useStaffRefusal()
  const liveHome = useQuery({
    queryKey: staffSelfKeys.home(userId),
    queryFn: () => fns.getMyStaffHome(),
    initialData: home,
    retry: false,
    refetchOnWindowFocus: 'always',
  })
  const acknowledge = useActionMutation(fns.acknowledgeStaffNotice, {
    onSuccess: () => client.invalidateQueries({ queryKey: staffSelfKeys.home(userId) }),
  })
  const participation = ownStaffParticipation(liveHome.data, search.p)
  if (liveHome.isError && !liveHome.data)
    return (
      <RegionError
        message={actionErrorMessage(liveHome.error)}
        onRetry={() => void liveHome.refetch()}
        retrying={liveHome.isFetching}
      />
    )
  if (!participation) return null
  if (!participation.noticeAcknowledged)
    return (
      <StaffNotice
        pending={acknowledge.isPending}
        error={acknowledge.error}
        onAccept={() =>
          void acknowledge({ data: { version: STAFF_NOTICE_VERSION } }).catch(
            () => undefined,
          )
        }
      />
    )
  return (
    <StaffHomeView
      home={liveHome.data}
      participation={participation}
      search={search}
      onSearch={onSearch}
      fns={fns}
      embedded={embedded}
    />
  )
}
