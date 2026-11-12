import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createKeys } from '#/shared/queries/query-keys'
import { clearTenantCacheAfterTenantChange } from '#/shared/queries/tenant-cache-transition'
import type { ProductUpdatesView } from '#/shared/whats-new/types'
import { optimisticAutoShow } from './preferences-cache'

const scope = { userId: 'user-1', organizationId: 'org-1' }
const { productUpdateKeys } = createKeys(scope)

const initial: ProductUpdatesView = {
  entries: [],
  unseenIds: ['unseen'],
  autoShow: true,
  shouldAutoOpen: true,
}
describe('personal update switch save and rollback', () => {
  it('moves every property-scoped copy immediately and restores them on failure', () => {
    const client = new QueryClient()
    const keys = [productUpdateKeys.scope(null), productUpdateKeys.scope('property')]
    for (const key of keys) client.setQueryData(key, initial)
    client.setQueryData(['unrelated'], 'untouched')
    const undo = optimisticAutoShow(client, scope, false)
    for (const key of keys)
      expect(client.getQueryData(key)).toMatchObject({
        autoShow: false,
        shouldAutoOpen: false,
        unseenIds: ['unseen'],
      })
    undo()
    for (const key of keys) expect(client.getQueryData(key)).toEqual(initial)
    expect(client.getQueryData(['unrelated'])).toBe('untouched')
    client.clear()
  })
  it('keeps a successful save and waits for the server to decide a new automatic opening', () => {
    const client = new QueryClient()
    client.setQueryData(productUpdateKeys.scope(null), {
      ...initial,
      autoShow: false,
      shouldAutoOpen: false,
    })
    optimisticAutoShow(client, scope, true)
    expect(client.getQueryData(productUpdateKeys.scope(null))).toMatchObject({
      autoShow: true,
      shouldAutoOpen: false,
    })
    client.clear()
  })

  it.each([
    { userId: 'user-2', organizationId: 'org-1' },
    { userId: 'user-1', organizationId: 'org-2' },
    { userId: 'user-1', organizationId: null },
  ])('leaves %j untouched during a save and rollback', (otherScope) => {
    const client = new QueryClient()
    const key = productUpdateKeys.scope(null)
    const otherKey = createKeys(otherScope).productUpdateKeys.scope(null)
    client.setQueryData(key, initial)
    client.setQueryData(otherKey, initial)

    const undo = optimisticAutoShow(client, scope, false)

    expect(client.getQueryData(key)).toMatchObject({ autoShow: false })
    expect(client.getQueryData(otherKey)).toEqual(initial)
    const otherView = { ...initial, unseenIds: [] }
    client.setQueryData(otherKey, otherView)
    undo()
    expect(client.getQueryData(key)).toEqual(initial)
    expect(client.getQueryData(otherKey)).toEqual(otherView)
    client.clear()
  })

  it('does not restore the previous tenant after a refused save finishes following teardown', () => {
    const client = new QueryClient()
    const key = productUpdateKeys.scope(null)
    client.setQueryData(key, initial)
    const undo = optimisticAutoShow(client, scope, false)

    clearTenantCacheAfterTenantChange(client)
    undo()

    expect(client.getQueryCache().getAll()).toEqual([])
  })

  it('does not overwrite a fresh read when the same person returns after teardown', () => {
    const client = new QueryClient()
    const key = productUpdateKeys.scope(null)
    client.setQueryData(key, initial)
    const undo = optimisticAutoShow(client, scope, false)

    clearTenantCacheAfterTenantChange(client)
    const latest = { ...initial, unseenIds: [] }
    client.setQueryData(key, latest)
    undo()

    expect(client.getQueryData(key)).toEqual(latest)
    client.clear()
  })
})
