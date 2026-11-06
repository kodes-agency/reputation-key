import { CancelledError, QueryClient, hashKey } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createKeys } from './query-keys'
import { clearTenantCacheAfterTenantChange } from './tenant-cache-transition'

const first = { userId: 'person-1', organizationId: 'org-1' }

describe('tenant query scope', () => {
  it.each([
    { userId: 'person-1', organizationId: 'org-2' },
    { userId: 'person-2', organizationId: 'org-1' },
    { userId: 'person-1', organizationId: null },
  ])('isolates every scoped read from %j', (other) => {
    const client = new QueryClient()
    const ours = createKeys(first)
    const theirs = createKeys(other)
    const args = Array.from({ length: 6 }, () => 'probe')
    for (const family of Object.keys(ours) as (keyof typeof ours)[]) {
      for (const [name, member] of Object.entries(ours[family])) {
        const read = (value: unknown) =>
          typeof value === 'function' ? Reflect.apply(value, undefined, args) : value
        const key = read(member)
        const otherKey = read(Reflect.get(theirs[family], name))
        expect(hashKey(key)).not.toBe(hashKey(otherKey))
        client.setQueryData(key, { owner: 'first' })
        expect(client.getQueryData(otherKey)).toBeUndefined()
      }
    }
    client.clear()
  })

  it('invalidates only the scoped family and keeps notification settings apart from its feed', async () => {
    const client = new QueryClient()
    const ours = createKeys(first)
    const theirs = createKeys({ ...first, organizationId: 'org-2' })
    const feed = ours.notificationKeys.head('org-1', 20)
    const settings = ours.notificationKeys.preferences('org-1')
    const otherFeed = theirs.notificationKeys.head('org-2', 20)
    for (const key of [feed, settings, otherFeed]) client.setQueryData(key, 'cached')

    await client.invalidateQueries({ queryKey: ours.notificationKeys.feed('org-1') })

    expect(client.getQueryState(feed)?.isInvalidated).toBe(true)
    expect(client.getQueryState(settings)?.isInvalidated).toBe(false)
    expect(client.getQueryState(otherFeed)?.isInvalidated).toBe(false)
    clearTenantCacheAfterTenantChange(client)
    expect(client.getQueryCache().getAll()).toEqual([])
  })

  it('does not restore an old tenant entry when a read completes after teardown', async () => {
    const client = new QueryClient()
    const key = createKeys(first).identityKeys.members()
    let finish!: (members: string[]) => void
    const pending = client.fetchQuery({
      queryKey: key,
      queryFn: () =>
        new Promise<string[]>((resolve) => {
          finish = resolve
        }),
    })
    const refused = expect(pending).rejects.toThrow(CancelledError)

    clearTenantCacheAfterTenantChange(client)
    finish(['old tenant member'])
    await refused

    expect(client.getQueryData(key)).toBeUndefined()
    expect(client.getQueryCache().getAll()).toEqual([])
  })
})
