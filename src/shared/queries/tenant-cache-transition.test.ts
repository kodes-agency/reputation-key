import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  clearTenantCacheAfterSessionEnd,
  clearTenantCacheAfterTenantChange,
  clearTenantCacheBeforeNavigation,
} from './tenant-cache-transition'
import { notificationKeys } from './query-keys'
import { shellContextKeys } from './shell-context-cache'

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

  it('ends the session, clears tenant data, then leaves the authenticated surface', async () => {
    const calls: string[] = []
    const endSession = vi.fn(async () => {
      calls.push('end-session')
    })
    const clear = vi.fn(() => calls.push('clear'))
    const navigate = vi.fn(async () => {
      calls.push('navigate')
    })

    await clearTenantCacheAfterSessionEnd({ clear }, endSession, navigate)

    expect(calls).toEqual(['end-session', 'clear', 'navigate'])
  })

  it('clears cached queries and mutations after a confirmed tenant change', () => {
    const clear = vi.fn()

    clearTenantCacheAfterTenantChange({ clear })

    expect(clear).toHaveBeenCalledOnce()
  })

  // The shell remembers who is signed in for 30 seconds (ADR 0072). A sign-out or a
  // sign-in must not leave that answer for the next navigation, here or in another tab.
  it('forgets the shell checks with the rest and tells the other tabs', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(shellContextKeys.session(), { user: { id: 'user-1' } })
    queryClient.setQueryData(shellContextKeys.organization('user-1'), {
      name: 'Riverside',
    })
    const otherTab = new BroadcastChannel('repkey-shell-context')
    const announced = new Promise((received) => {
      otherTab.onmessage = (event: MessageEvent) => received(event.data)
    })

    await clearTenantCacheAfterSessionEnd(queryClient, async () => undefined)

    expect(
      queryClient.getQueryCache().findAll({ queryKey: shellContextKeys.all }),
    ).toEqual([])
    await expect(announced).resolves.toBe('forget')
    otherTab.close()
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
