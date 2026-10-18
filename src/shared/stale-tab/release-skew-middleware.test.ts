// The two halves of the check that rides on every server-function call.
// The tab states which release its code came from; the server compares it with
// its own before any handler, validator or other middleware of the function
// runs. A read from a stale tab is refused with a typed 409. A mutation is
// finished (today's behaviour) and flagged, so the tab reloads at its next
// navigation instead of losing the call.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isServerFunctionError } from '#/shared/auth/server-function-error'
import { RELEASE_HEADER, STALE_CLIENT_CODE } from './release-skew'
import { createStaleTab } from './stale-tab'

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

const { releaseSkewServerMiddleware, releaseSkewClientMiddleware, sendWithRelease } =
  await import('./release-skew-middleware')

const OLD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)

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
