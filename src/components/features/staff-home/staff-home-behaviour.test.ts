import { act, createElement, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { setupHookRoot } from '#/shared/testing/hook-root'
import { staffSelfKeys } from '#/shared/queries/query-keys'
import { StaffHome } from './staff-home'
import { STAFF_HOME_FIXTURE, STAFF_HOME_FNS } from './staff-home-fixtures'
import type { StaffHomeSearch } from './types'
const drawn = vi.hoisted(() => ({
  view: vi.fn(),
  notice: vi.fn(),
  invalidate: vi.fn(),
  error: vi.fn(),
}))
vi.mock('./staff-home-view', () => ({
  StaffHomeView: (props: unknown) => {
    drawn.view(props)
    return null
  },
}))
vi.mock('./staff-notice', () => ({
  StaffNotice: (props: unknown) => {
    drawn.notice(props)
    return null
  },
}))
vi.mock('#/components/ui/region-error', () => ({
  RegionError: (props: unknown) => {
    drawn.error(props)
    return null
  },
}))
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({ invalidate: drawn.invalidate }),
}))
const root = setupHookRoot()
async function mount(acknowledged = true, p = 'stale-id') {
  vi.clearAllMocks()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const home = {
    ...STAFF_HOME_FIXTURE,
    participations: STAFF_HOME_FIXTURE.participations.map((row) => ({
      ...row,
      noticeAcknowledged: acknowledged,
    })),
  }
  const getMyStaffHome = vi.fn().mockResolvedValue(home)
  const acknowledgeStaffNotice = vi.fn().mockImplementation(async () => {
    getMyStaffHome.mockResolvedValue({
      ...home,
      participations: home.participations.map((row) => ({
        ...row,
        noticeAcknowledged: true,
      })),
    })
    return { acknowledged: true }
  })
  function Screen() {
    const [search, setSearch] = useState<StaffHomeSearch>({
      p,
      tab: 'code',
      period: 'month',
    })
    return createElement(StaffHome, {
      home,
      userId: 'polly',
      search,
      onSearch: setSearch,
      fns: { ...STAFF_HOME_FNS, getMyStaffHome, acknowledgeStaffNotice },
    })
  }
  await root.render(createElement(QueryClientProvider, { client }, createElement(Screen)))
  return { client, getMyStaffHome, acknowledgeStaffNotice }
}
it('gates all everyday content behind notice acknowledgement', async () => {
  const { acknowledgeStaffNotice } = await mount(false)
  expect(drawn.view).not.toHaveBeenCalled()
  await act(async () => drawn.notice.mock.lastCall![0].onAccept())
  await root.flush()
  expect(acknowledgeStaffNotice).toHaveBeenCalledOnce()
  expect(drawn.view).toHaveBeenCalled()
})
it('uses an owned participation for stale p and switches tabs through URL state', async () => {
  await mount()
  const props = drawn.view.mock.lastCall![0]
  expect(props.participation.participationId).toBe(
    STAFF_HOME_FIXTURE.participations[0]!.participationId,
  )
  await act(async () => props.onSearch({ ...props.search, tab: 'results' }))
  expect(drawn.view.mock.lastCall![0].search.tab).toBe('results')
})
it('keeps Code and its data when a background refetch fails', async () => {
  const { client, getMyStaffHome } = await mount()
  getMyStaffHome.mockRejectedValue(new Error('Try again later.'))
  await act(async () => client.refetchQueries({ queryKey: staffSelfKeys.home('polly') }))
  await root.flush()
  expect(drawn.error).not.toHaveBeenCalled()
  expect(drawn.view.mock.lastCall![0].search.tab).toBe('code')
  expect(drawn.view.mock.lastCall![0].home).toEqual(STAFF_HOME_FIXTURE)
})
