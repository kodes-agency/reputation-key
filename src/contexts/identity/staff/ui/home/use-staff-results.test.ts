import { act, createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { setupHookRoot } from '#/shared/testing/hook-root'
import { clearTenantCacheAfterTenantChange } from '#/shared/queries/tenant-cache-transition'
import { STAFF_RESULTS_FIXTURE } from './staff-home-fixtures'
import type { StaffResults } from './types'
import { useStaffResults } from './use-staff-results'

vi.mock('#/shared/hooks/useTenantScope', () => ({
  useTenantScope: () => ({ userId: 'staff-1', organizationId: null }),
}))
const root = setupHookRoot()

it('keeps a late Staff results read from repopulating a cleared tenant cache', async () => {
  const client = new QueryClient()
  let finish!: (results: StaffResults) => void
  const read = () =>
    new Promise<StaffResults>((resolve) => {
      finish = resolve
    })
  function Results() {
    useStaffResults(read, 'participation', 'week')
    return null
  }
  await root.render(
    createElement(QueryClientProvider, { client }, createElement(Results)),
  )

  clearTenantCacheAfterTenantChange(client)
  await root.render(null)
  await act(async () => finish(STAFF_RESULTS_FIXTURE))
  await root.flush()

  expect(client.getQueryCache().getAll()).toEqual([])
})
