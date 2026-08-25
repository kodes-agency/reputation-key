import { describe, expect, it, vi } from 'vitest'
import { clearTenantCacheBeforeNavigation } from './tenant-cache-transition'
import { notificationKeys } from './query-keys'

describe('tenant cache transition', () => {
  it('clears cached tenant data before organization navigation starts', async () => {
    const calls: string[] = []
    const clear = vi.fn(() => calls.push('clear'))
    const navigate = vi.fn(async () => {
      calls.push('navigate')
    })

    await clearTenantCacheBeforeNavigation({ clear }, navigate)

    expect(calls).toEqual(['clear', 'navigate'])
    expect(clear).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('partitions notification cache keys by organization', () => {
    expect(notificationKeys.preferences('org-1')).not.toEqual(
      notificationKeys.preferences('org-2'),
    )
    expect(notificationKeys.list('org-1', 20)).not.toEqual(
      notificationKeys.list('org-2', 20),
    )
  })

  it('partitions notification list pages by server-side filter', () => {
    expect(notificationKeys.list('org-1', 20, 'all')).not.toEqual(
      notificationKeys.list('org-1', 20, 'urgent'),
    )
  })
})
