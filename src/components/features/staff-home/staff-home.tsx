import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '#/components/ui/tabs'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '#/components/ui/select'
import { RegionError } from '#/components/ui/region-error'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { STAFF_NOTICE_VERSION } from '#/contexts/identity/application/public-api'
import { staffSelfKeys } from '#/shared/queries/query-keys'
import { httpStatus } from '#/shared/security/expected-refusal'
import { StaffNotice } from './staff-notice'
import { StaffAccountMenu } from './staff-account-menu'
import { StaffCode } from './staff-code'
import { StaffResults } from './staff-results'
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
  const router = useRouter()
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
  useEffect(() => {
    if (
      liveHome.error &&
      [400, 401, 403, 404].includes(httpStatus(liveHome.error) ?? 0)
    ) {
      client.removeQueries({ queryKey: staffSelfKeys.all })
      void router.invalidate({
        filter: (match) =>
          match.routeId === '/my' || match.routeId === '/_authenticated/my-code',
      })
    }
  }, [liveHome.error, client, router])
  const participation = ownStaffParticipation(liveHome.data, search.p)
  if (liveHome.isError)
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
    <div
      className={
        embedded
          ? 'mx-auto flex min-h-[70svh] w-full max-w-md flex-col'
          : 'mx-auto flex min-h-svh w-full max-w-md flex-col'
      }
    >
      <header className="flex min-w-0 items-center justify-between gap-3 border-b px-4 py-2">
        {liveHome.data.participations.length > 1 ? (
          <Select
            value={participation.participationId}
            onValueChange={(p) => onSearch({ ...search, p, tab: 'code' })}
          >
            <SelectTrigger variant="property" aria-label="Property">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {liveHome.data.participations.map((row) => (
                <SelectItem key={row.participationId} value={row.participationId}>
                  {row.propertyName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="min-w-0 break-words font-semibold">
            {participation.propertyName}
          </p>
        )}
        <StaffAccountMenu fns={fns} />
      </header>
      <h1 className="sr-only">My code</h1>
      <Tabs
        value={search.tab}
        onValueChange={(tab) => {
          if (tab === 'code' || tab === 'results') onSearch({ ...search, tab })
        }}
        className="flex-1"
      >
        <div className="flex flex-1 flex-col justify-center p-4">
          <TabsContent value="code" placement="center">
            <StaffCode
              key={participation.participationId}
              participationId={participation.participationId}
              propertyName={participation.propertyName}
              read={fns.getMyCode}
            />
          </TabsContent>
          <TabsContent value="results">
            <StaffResults
              participation={participation}
              period={search.period}
              onPeriod={(period) => onSearch({ ...search, period })}
              fns={fns}
            />
          </TabsContent>
        </div>
        <TabsList variant="bottom" aria-label="Your code and results">
          <TabsTrigger value="code">Code</TabsTrigger>
          <TabsTrigger value="results">My results</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  )
}
