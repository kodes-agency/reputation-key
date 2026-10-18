// The two halves of the check that rides on every server-function call.
// The tab states which release its code came from; the server compares it with
// its own before any handler, validator or other middleware of the function
// runs. A read from a stale tab is refused with a typed 409. A mutation is
// finished (today's behaviour) and flagged, so the tab reloads at its next
// navigation instead of losing the call.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isServerFunctionError } from '#/shared/auth/server-function-error'
import {
  RELEASE_HEADER,
  STALE_CLIENT_CODE,
  UNKNOWN_SERVER_FUNCTION_BODY,
} from './release-skew'
// Static on purpose: vi.mock and vi.hoisted are hoisted above it, so the module
// loads with the mocks in place, and the changed-code gate reads the import.
import {
  releaseSkewClientMiddleware,
  releaseSkewServerMiddleware,
  sendWithRelease,
} from './release-skew-middleware'
import { FRESH_VIEW_MS, createStaleTab } from './stale-tab'

const hoisted = vi.hoisted(() => ({
  release: 'b'.repeat(40) as string | undefined,
  failConfig: false,
  headers: new Headers(),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () =>
    new Request('https://manager.example/_server/action', {
      headers: hoisted.headers,
    }),
}))

vi.mock('#/shared/config/request-runtime-config', () => ({
  requestRuntimeConfig: () => {
    if (hoisted.failConfig) throw new Error('env is not parsed')
    return { env: { RELEASE_SHA: hoisted.release } }
  },
}))

const OLD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)

type NavigationEvent = Readonly<{
  pathChanged: boolean
  toLocation: Readonly<{ publicHref: string; searchStr: string }>
}>

type ServerRunner = (input: {
  method: 'GET' | 'POST'
  next: (options?: unknown) => Promise<unknown>
}) => Promise<unknown>

function callServer(
  headers: Record<string, string>,
  method: 'GET' | 'POST',
): { run: Promise<unknown>; next: ReturnType<typeof vi.fn> } {
  const server = releaseSkewServerMiddleware.options.server as unknown as ServerRunner
  const next = vi.fn(async (options?: unknown) => ({ reached: true, options }))
  hoisted.headers = new Headers(headers)
  return { run: server({ method, next }), next }
}

beforeEach(() => {
  hoisted.release = NEW
  hoisted.failConfig = false
})

describe('release skew, on the server', () => {
  it('lets a call from a tab on the same release straight through', async () => {
    const { run, next } = callServer({ [RELEASE_HEADER]: NEW }, 'GET')

    await expect(run).resolves.toMatchObject({ reached: true })
    expect(next).toHaveBeenCalledOnce()
    expect(next.mock.calls[0]?.[0]).toEqual({})
  })

  it('refuses a read from an older tab with the typed 409, without reaching the handler', async () => {
    const { run, next } = callServer({ [RELEASE_HEADER]: OLD }, 'GET')

    const refusal = await run.catch((error: unknown) => error)

    expect(isServerFunctionError(refusal)).toBe(true)
    expect(refusal).toMatchObject({ code: STALE_CLIENT_CODE, status: 409 })
    expect(next).not.toHaveBeenCalled()
  })

  it('finishes a mutation from an older tab and flags it', async () => {
    const { run, next } = callServer({ [RELEASE_HEADER]: OLD }, 'POST')

    await run

    expect(next).toHaveBeenCalledOnce()
    expect(next.mock.calls[0]?.[0]).toEqual({ sendContext: { releaseSkew: true } })
  })

  it('does nothing for a caller that sends no release', async () => {
    const { run, next } = callServer({}, 'GET')

    await run

    expect(next).toHaveBeenCalledOnce()
  })

  it('does nothing when the server has no release of its own to compare', async () => {
    hoisted.release = undefined
    const { run, next } = callServer({ [RELEASE_HEADER]: OLD }, 'GET')

    await run

    expect(next).toHaveBeenCalledOnce()
  })

  it('fails open when the configuration cannot be read, rather than refusing every call', async () => {
    hoisted.failConfig = true
    const { run, next } = callServer({ [RELEASE_HEADER]: OLD }, 'GET')

    await run

    expect(next).toHaveBeenCalledOnce()
  })
})

describe('release skew, in the tab', () => {
  function tabOn(release: string | undefined) {
    const tab = createStaleTab({
      storage: () => null,
      now: () => 1,
      reload: vi.fn(),
      later: vi.fn(),
    })
    tab.remember(release)
    return tab
  }

  /**
   * A tab on OLD with the router wired in. `navigate` is the router announcing a
   * navigation to another view; `clock` is the time the tab reads.
   */
  function tabWithRouter() {
    const reload = vi.fn()
    const items = new Map<string, string>()
    const clock = { now: 1_000 }
    const tab = createStaleTab({
      storage: () => ({
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => void items.set(key, value),
      }),
      now: () => clock.now,
      reload,
      later: vi.fn(),
    })
    tab.remember(OLD)
    let announce: (event: NavigationEvent) => void = () => undefined
    tab.reloadOnNavigation({
      subscribe: (_type, listener) => {
        announce = listener
        return () => undefined
      },
    })
    const navigate = (href: string): void =>
      announce({ pathChanged: true, toLocation: { searchStr: '', publicHref: href } })
    return { tab, reload, clock, navigate }
  }

  it('states the release its code came from', async () => {
    const tab = tabOn(OLD)
    const next = vi.fn(async (_options?: unknown) => ({ context: {} }))

    await sendWithRelease(tab, 'GET', next)

    expect(next).toHaveBeenCalledWith({ headers: { [RELEASE_HEADER]: OLD } })
  })

  it('sends nothing, and changes nothing, when the tab does not know its release', async () => {
    const tab = tabOn(undefined)
    const next = vi.fn(async (_options?: unknown) => ({ context: {} }))

    await sendWithRelease(tab, 'POST', next)

    expect(next).toHaveBeenCalledWith()
    expect(tab.isStale()).toBe(false)
  })

  it('arms the tab when the server flags a finished mutation', async () => {
    const tab = tabOn(OLD)
    const next = vi.fn(async (_options?: unknown) => ({
      context: { releaseSkew: true },
    }))

    const result = await sendWithRelease(tab, 'POST', next)

    expect(result).toEqual({ context: { releaseSkew: true } })
    expect(tab.isStale()).toBe(true)
  })

  it('does not arm the tab for an unflagged answer', async () => {
    const tab = tabOn(OLD)
    const next = vi.fn(async (_options?: unknown) => ({ context: {} }))

    await sendWithRelease(tab, 'GET', next)

    expect(tab.isStale()).toBe(false)
  })

  it('arms the tab on the typed refusal, and lets the caller see it', async () => {
    const tab = tabOn(OLD)
    const refusal = Object.assign(new Error('Reload'), {
      _tag: 'StaleClient',
      code: STALE_CLIENT_CODE,
      status: 409,
    })
    const next = vi.fn(async (_options?: unknown) => {
      throw refusal
    })

    await expect(sendWithRelease(tab, 'GET', next)).rejects.toBe(refusal)

    expect(tab.isStale()).toBe(true)
  })

  it('reloads straight away when the refusal answers a view a navigation has just drawn', async () => {
    const { tab, reload, navigate } = tabWithRouter()
    navigate('/inbox?itemId=2')
    const refusal = Object.assign(new Error('Reload'), {
      _tag: 'StaleClient',
      code: STALE_CLIENT_CODE,
      status: 409,
    })
    const next = vi.fn(async (_options?: unknown) => {
      throw refusal
    })

    await expect(sendWithRelease(tab, 'GET', next)).rejects.toBe(refusal)

    expect(reload).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledWith(undefined)
  })

  // A deploy removed the function this tab still calls, so the server answers
  // with a plain 404 (unknown-server-function.ts) and Start's client throws it
  // as an Error. A current client never asks for an id the build lacks, so no
  // release comparison is needed: the tab's code is older than the server's.
  const unknownFunction = () => new Error(UNKNOWN_SERVER_FUNCTION_BODY)

  it('arms the tab when a read asks for a function the server no longer has, and lets the caller see it', async () => {
    const tab = tabOn(OLD)
    const error = unknownFunction()
    const next = vi.fn(async (_options?: unknown) => {
      throw error
    })

    await expect(sendWithRelease(tab, 'GET', next)).rejects.toBe(error)

    expect(tab.isStale()).toBe(true)
  })

  it('reloads straight away when that read answers a view a navigation has just drawn', async () => {
    const { tab, reload, navigate } = tabWithRouter()
    navigate('/inbox?itemId=2')
    const next = vi.fn(async (_options?: unknown) => {
      throw unknownFunction()
    })

    await expect(sendWithRelease(tab, 'GET', next)).rejects.toThrow()

    expect(reload).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledWith(undefined)
  })

  it('only arms the tab when that read comes after the view was drawn, as a refused read does', async () => {
    const { tab, reload, clock, navigate } = tabWithRouter()
    navigate('/inbox?itemId=2')
    clock.now += FRESH_VIEW_MS
    const next = vi.fn(async (_options?: unknown) => {
      throw unknownFunction()
    })

    await expect(sendWithRelease(tab, 'GET', next)).rejects.toThrow()

    expect(tab.isStale()).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('arms the tab, without reloading it, when a mutation asks for a function the server no longer has', async () => {
    const { tab, reload, navigate } = tabWithRouter()
    navigate('/inbox?itemId=2')
    const error = unknownFunction()
    const next = vi.fn(async (_options?: unknown) => {
      throw error
    })

    await expect(sendWithRelease(tab, 'POST', next)).rejects.toBe(error)

    // Whatever the person was filling in stays on screen.
    expect(tab.isStale()).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads at the next navigation after such a mutation', async () => {
    const { tab, reload, navigate } = tabWithRouter()
    const next = vi.fn(async (_options?: unknown) => {
      throw unknownFunction()
    })
    await expect(sendWithRelease(tab, 'POST', next)).rejects.toThrow()

    navigate('/properties')

    expect(reload).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledWith('/properties')
  })

  it.each(['GET', 'POST'])(
    'does nothing about that failure in a tab that does not know its release (%s)',
    async (method) => {
      const tab = tabOn(undefined)
      const error = unknownFunction()
      const next = vi.fn(async (_options?: unknown) => {
        throw error
      })

      await expect(sendWithRelease(tab, method, next)).rejects.toBe(error)

      expect(tab.isStale()).toBe(false)
    },
  )

  it.each([
    ['GET', 'Not Found'],
    ['POST', 'Not Found'],
    ['GET', 'Unknown server function: x'],
    ['POST', 'unknown server function'],
    ['GET', 'Internal Server Error'],
    ['POST', ''],
  ])('leaves the tab alone for a %s that fails with "%s"', async (method, message) => {
    const { tab, reload, navigate } = tabWithRouter()
    navigate('/inbox?itemId=2')
    const error = new Error(message)
    const next = vi.fn(async (_options?: unknown) => {
      throw error
    })

    await expect(sendWithRelease(tab, method, next)).rejects.toBe(error)

    expect(tab.isStale()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('leaves the tab alone for any other failure', async () => {
    const tab = tabOn(OLD)
    const next = vi.fn(async (_options?: unknown) => {
      throw new TypeError('Load failed')
    })

    await expect(sendWithRelease(tab, 'GET', next)).rejects.toThrow('Load failed')

    expect(tab.isStale()).toBe(false)
  })

  it('counts a mutation as in flight until it settles', async () => {
    const tab = tabOn(OLD)
    let settle: () => void = () => undefined
    const next = vi.fn(
      (_options?: unknown) =>
        new Promise<{ context: object }>((resolve) => {
          settle = () => resolve({ context: {} })
        }),
    )

    const call = sendWithRelease(tab, 'POST', next)

    expect(tab.reload()).toBe('deferred')

    settle()
    await call

    expect(tab.reload()).not.toBe('deferred')
  })

  it('does not hold a reload back for a read', async () => {
    const tab = tabOn(OLD)
    const next = vi.fn(
      (_options?: unknown) => new Promise<{ context: object }>(() => undefined),
    )

    void sendWithRelease(tab, 'GET', next)

    expect(tab.reload()).not.toBe('deferred')
  })
})

describe('registration', () => {
  it('registers the client half, which depends on the server half so both run', () => {
    expect(releaseSkewClientMiddleware.options.middleware).toEqual([
      releaseSkewServerMiddleware,
    ])
    expect(releaseSkewClientMiddleware.options.client).toBeTypeOf('function')
    expect(releaseSkewServerMiddleware.options.server).toBeTypeOf('function')
  })
})
