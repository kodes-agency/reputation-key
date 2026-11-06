import { CancelledError, QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { createKeys } from '#/shared/queries/query-keys'
import { clearTenantCacheAfterTenantChange } from '#/shared/queries/tenant-cache-transition'
import type { ProductUpdatesClient, ProductUpdatesView } from '#/shared/whats-new/types'
import { productUpdatesQuery } from './queries'

const scope = { userId: 'user-1', organizationId: 'org-1' }
const view: ProductUpdatesView = {
  entries: [],
  unseenIds: ['update-1'],
  autoShow: true,
  shouldAutoOpen: true,
}

function makeClient() {
  return {
    get: vi.fn<ProductUpdatesClient['get']>().mockResolvedValue(view),
    claim: vi.fn<ProductUpdatesClient['claim']>(),
    markSeen: vi.fn<ProductUpdatesClient['markSeen']>(),
    setAutoShow: vi.fn<ProductUpdatesClient['setAutoShow']>(),
    aiNoticeUpdate: { get: vi.fn(), markSeen: vi.fn() },
  } satisfies ProductUpdatesClient
}

describe('product update queries', () => {
  it.each([
    { userId: 'user-2', organizationId: 'org-1' },
    { userId: 'user-1', organizationId: 'org-2' },
    { userId: 'user-1', organizationId: null },
  ])('does not reuse a cached answer for %j', async (otherScope) => {
    const client = new QueryClient()
    const transport = makeClient()
    const getClient = async () => transport
    const ours = productUpdatesQuery(scope, null, getClient)
    const theirs = productUpdatesQuery(otherScope, null, getClient)
    await client.fetchQuery(ours)

    expect(client.getQueryData(theirs.queryKey)).toBeUndefined()
    await client.fetchQuery(theirs)
    expect(transport.get).toHaveBeenCalledTimes(2)
    expect(transport.get).toHaveBeenLastCalledWith({ data: { propertyId: undefined } })
    client.clear()
  })

  it('shares one property read between consumers and invalidates only its tenant family', async () => {
    const client = new QueryClient()
    const transport = makeClient()
    const getClient = async () => transport
    const property = productUpdatesQuery(scope, 'property-1', getClient)
    const organization = productUpdatesQuery(scope, null, getClient)
    const other = productUpdatesQuery(
      { ...scope, organizationId: 'org-2' },
      null,
      getClient,
    )
    await client.fetchQuery(property)
    await client.fetchQuery(productUpdatesQuery(scope, 'property-1', getClient))
    expect(transport.get).toHaveBeenCalledExactlyOnceWith({
      data: { propertyId: 'property-1' },
    })
    client.setQueryData(organization.queryKey, view)
    client.setQueryData(other.queryKey, view)

    await client.invalidateQueries({ queryKey: createKeys(scope).productUpdateKeys.all })

    expect(client.getQueryState(property.queryKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(organization.queryKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(other.queryKey)?.isInvalidated).toBe(false)
    client.clear()
  })

  it('keeps a read that completes after tenant teardown out of the cache', async () => {
    const client = new QueryClient()
    const transport = makeClient()
    let finish!: (value: ProductUpdatesView) => void
    transport.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const options = productUpdatesQuery(scope, null, async () => transport)
    const pending = client.fetchQuery(options)
    const refused = expect(pending).rejects.toThrow(CancelledError)
    await vi.waitFor(() => expect(transport.get).toHaveBeenCalledOnce())

    clearTenantCacheAfterTenantChange(client)
    finish(view)
    await refused

    expect(client.getQueryData(options.queryKey)).toBeUndefined()
    expect(client.getQueryCache().getAll()).toEqual([])
  })
})
