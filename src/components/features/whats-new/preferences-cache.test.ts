import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { productUpdateKeys } from '#/shared/queries/query-keys'
import type { ProductUpdatesView } from '#/shared/whats-new/types'
import { optimisticAutoShow } from './preferences-cache'

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
    const undo = optimisticAutoShow(client, false)
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
    optimisticAutoShow(client, true)
    expect(client.getQueryData(productUpdateKeys.scope(null))).toMatchObject({
      autoShow: true,
      shouldAutoOpen: false,
    })
    client.clear()
  })
})
