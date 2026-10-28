// The ways the shell's remembered checks are forgotten.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  forgetShellContextOnReturn,
  invalidateShellContext,
  shellCheckSide,
  shellContextForgotten,
  shellContextGeneration,
  noteSignedInUser,
  shellContextKeys,
} from './shell-context-cache'
import { identityKeys } from './query-keys'

const USER = 'user-1'

function rememberedShell(): QueryClient {
  const queryClient = new QueryClient()
  queryClient.setQueryData(shellContextKeys.session(), { user: { id: USER } })
  queryClient.setQueryData(shellContextKeys.organization(USER), { name: 'Riverside' })
  queryClient.setQueryData(shellContextKeys.capabilities(USER, null), { allowed: [] })
  queryClient.setQueryData(shellContextKeys.routeGate(USER, 'goal.use', 'p-1'), {
    allowed: true,
  })
  queryClient.setQueryData(identityKeys.members(), [])
  return queryClient
}

const shellEntries = (queryClient: QueryClient) =>
  queryClient.getQueryCache().findAll({ queryKey: shellContextKeys.all }).length

/** A message on the shell channel, as another tab of the person would see it. */
function nextAnnouncement(): Promise<unknown> {
  const otherTab = new BroadcastChannel('repkey-shell-context')
  return new Promise((received) => {
    otherTab.onmessage = (event: MessageEvent) => {
      otherTab.close()
      received(event.data)
    }
  })
}

describe('shellContextKeys', () => {
  it('puts every entry but the session under the person it answers for', () => {
    const person = shellContextKeys.person(USER)
    for (const key of [
      shellContextKeys.organization(USER),
      shellContextKeys.capabilities(USER, 'p-1'),
      shellContextKeys.routeGate(USER, 'goal.use', null),
    ]) {
      expect(key.slice(0, person.length)).toEqual(person)
    }
    expect(shellContextKeys.capabilities(USER, 'p-1')).not.toEqual(
      shellContextKeys.capabilities('user-2', 'p-1'),
    )
  })
})

describe('invalidateShellContext', () => {
  it('removes every shell entry and leaves the rest of the cache', () => {
    const queryClient = rememberedShell()

    invalidateShellContext(queryClient)

    expect(shellEntries(queryClient)).toBe(0)
    expect(queryClient.getQueryData(identityKeys.members())).toEqual([])
  })

  it("tells the person's other tabs", async () => {
    const announced = nextAnnouncement()
    invalidateShellContext(rememberedShell())
    await expect(announced).resolves.toBe('forget')
  })
})

describe('shellContextForgotten', () => {
  it('posts the same message without touching the cache', async () => {
    const queryClient = rememberedShell()
    const announced = nextAnnouncement()
    shellContextForgotten(queryClient)
    await expect(announced).resolves.toBe('tenant-changed')
    expect(shellEntries(queryClient)).toBe(4)
  })

  it('moves the generation on, as every forget does', () => {
    const queryClient = rememberedShell()
    expect(shellContextGeneration(queryClient)).toBe(0)
    shellContextForgotten(queryClient)
    invalidateShellContext(queryClient)
    expect(shellContextGeneration(queryClient)).toBe(2)
    expect(shellContextGeneration(new QueryClient())).toBe(0)
  })
})

describe('forgetShellContextOnReturn', () => {
  let page: EventTarget & { visibilityState: 'visible' | 'hidden' }
  let stop: (() => void) | undefined

  beforeEach(() => {
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' as const })
    vi.stubGlobal('document', page)
  })

  afterEach(() => {
    stop?.()
    vi.unstubAllGlobals()
  })

  const turn = (state: 'visible' | 'hidden') => {
    page.visibilityState = state
    page.dispatchEvent(new Event('visibilitychange'))
  }

  it('forgets the entries when the tab comes back, not when it is hidden', () => {
    const queryClient = rememberedShell()
    stop = forgetShellContextOnReturn(queryClient)

    turn('hidden')
    expect(shellEntries(queryClient)).toBe(4)
    turn('visible')
    expect(shellEntries(queryClient)).toBe(0)
  })

  it('forgets the entries when another tab announces a change', async () => {
    const queryClient = rememberedShell()
    stop = forgetShellContextOnReturn(queryClient)

    // Another tab's client: this one only hears the announcement.
    shellContextForgotten(new QueryClient())

    await vi.waitFor(() => expect(shellEntries(queryClient)).toBe(0))
  })

  it('forgets the entries but not the pages when another tab only changes the shell', async () => {
    const queryClient = rememberedShell()
    const onTenantChanged = vi.fn()
    stop = forgetShellContextOnReturn(queryClient, onTenantChanged)

    invalidateShellContext(new QueryClient())

    await vi.waitFor(() => expect(shellEntries(queryClient)).toBe(0))
    expect(onTenantChanged).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(identityKeys.members())).toEqual([])
  })

  it('hands a tenant change to the tab, which drops its pages for the new person', async () => {
    const queryClient = rememberedShell()
    const onTenantChanged = vi.fn()
    stop = forgetShellContextOnReturn(queryClient, onTenantChanged)

    shellContextForgotten(new QueryClient())

    await vi.waitFor(() => expect(onTenantChanged).toHaveBeenCalledTimes(1))
    expect(shellEntries(queryClient)).toBe(0)
  })

  it('listens once: a second subscription replaces the first', () => {
    const queryClient = rememberedShell()
    const first = vi.fn()
    forgetShellContextOnReturn(queryClient, first)
    stop = forgetShellContextOnReturn(queryClient, vi.fn())

    turn('hidden')
    turn('visible')
    // One visibility listener ran: one forget, not two.
    expect(shellContextGeneration(queryClient)).toBe(1)
  })

  it('stops listening when unsubscribed', () => {
    const queryClient = rememberedShell()
    forgetShellContextOnReturn(queryClient)()

    turn('hidden')
    turn('visible')
    expect(shellEntries(queryClient)).toBe(4)
  })
})

describe('noteSignedInUser', () => {
  it('reports a different person than the last one, and moves the generation on', () => {
    const queryClient = new QueryClient()

    expect(noteSignedInUser(queryClient, 'user-1')).toBe(false)
    expect(noteSignedInUser(queryClient, 'user-1')).toBe(false)
    expect(shellContextGeneration(queryClient)).toBe(0)
    expect(noteSignedInUser(queryClient, 'user-2')).toBe(true)
    expect(shellContextGeneration(queryClient)).toBe(1)
  })
})

describe('shellCheckSide', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is the server without a document and the browser with one', () => {
    expect(shellCheckSide()).toBe('server')
    vi.stubGlobal('document', {})
    expect(shellCheckSide()).toBe('browser')
  })
})
