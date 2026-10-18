// A reload that cures a stale tab can become a loop when the page it lands on
// is stale too (a cached document, a replica still on the old release). The
// guard allows one reload per release per window, remembers it across the
// reload in sessionStorage, and fails closed when it cannot remember.
import { describe, expect, it, vi } from 'vitest'
import { RELOAD_WINDOW_MS, createReloadGuard } from './reload-guard'

const RELEASE = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

function storage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  }
}

function setup(overrides: { storage?: ReturnType<typeof storage> | null } = {}) {
  const store = overrides.storage === null ? null : (overrides.storage ?? storage())
  let clock = 1_000_000
  const reload = vi.fn()
  const guard = createReloadGuard({
    storage: () => store,
    now: () => clock,
    reload,
  })
  return {
    guard,
    reload,
    store,
    advance: (ms: number) => void (clock += ms),
    now: () => clock,
  }
}

describe('createReloadGuard', () => {
  it('reloads the first time a release asks', () => {
    const { guard, reload } = setup()

    expect(guard.request(RELEASE)).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('loads the target it was given', () => {
    const { guard, reload } = setup()

    guard.request(RELEASE, '/properties?tab=a')

    expect(reload).toHaveBeenCalledWith('/properties?tab=a')
  })

  it('reloads the current page when no target is given', () => {
    const { guard, reload } = setup()

    guard.request(RELEASE)

    expect(reload).toHaveBeenCalledWith(undefined)
  })

  it('writes the attempt down before it reloads, so a reload that fails to arrive is still counted', () => {
    const { store, now } = setup()
    let seenAtReload: string | null | undefined
    const guard = createReloadGuard({
      storage: () => store,
      now,
      reload: () => {
        seenAtReload = store?.getItem(`repkey:stale-reload:${RELEASE}`)
      },
    })

    guard.request(RELEASE)

    expect(seenAtReload).toBe(String(now()))
  })

  it('counts its own ask, so a second ask for the release inside the window is refused (the tab asks once per page: stale-tab.ts)', () => {
    const { guard, reload } = setup()

    expect(guard.request(RELEASE)).toBe('reloading')
    expect(guard.request(RELEASE)).toBe('refused')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('refuses a second reload for the same release inside the window (the page it landed on is stale too)', () => {
    const first = setup()
    first.guard.request(RELEASE)
    const landed = createReloadGuard({
      storage: () => first.store,
      now: () => first.now() + 5_000,
      reload: first.reload,
    })

    expect(landed.request(RELEASE)).toBe('refused')
    expect(first.reload).toHaveBeenCalledOnce()
  })

  it('allows a reload again once the window has passed', () => {
    const first = setup()
    first.guard.request(RELEASE)
    const later = createReloadGuard({
      storage: () => first.store,
      now: () => first.now() + RELOAD_WINDOW_MS,
      reload: first.reload,
    })

    expect(later.request(RELEASE)).toBe('reloading')
    expect(first.reload).toHaveBeenCalledTimes(2)
  })

  it('keys the window by the release being left, so the next deploy is not held back', () => {
    const first = setup()
    first.guard.request(RELEASE)
    const nextDeploy = createReloadGuard({
      storage: () => first.store,
      now: () => first.now() + 1_000,
      reload: first.reload,
    })

    expect(nextDeploy.request(OTHER)).toBe('reloading')
  })

  it('treats a remembered time in the future as expired rather than blocking for good', () => {
    const { guard, reload } = setup({
      storage: storage({ [`repkey:stale-reload:${RELEASE}`]: String(9_999_999_999) }),
    })

    expect(guard.request(RELEASE)).toBe('reloading')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('treats an unreadable remembered value as nothing remembered', () => {
    const { guard } = setup({
      storage: storage({ [`repkey:stale-reload:${RELEASE}`]: 'garbage' }),
    })

    expect(guard.request(RELEASE)).toBe('reloading')
  })

  it('fails closed when there is no storage to remember in', () => {
    const { guard, reload } = setup({ storage: null })

    expect(guard.request(RELEASE)).toBe('refused')
    expect(reload).not.toHaveBeenCalled()
  })

  it('fails closed when storage throws on read', () => {
    const reload = vi.fn()
    const guard = createReloadGuard({
      storage: () => ({
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => undefined,
      }),
      now: () => 1,
      reload,
    })

    expect(guard.request(RELEASE)).toBe('refused')
    expect(reload).not.toHaveBeenCalled()
  })

  it('fails closed when storage throws on write', () => {
    const reload = vi.fn()
    const guard = createReloadGuard({
      storage: () => ({
        getItem: () => null,
        setItem: () => {
          throw new Error('quota')
        },
      }),
      now: () => 1,
      reload,
    })

    expect(guard.request(RELEASE)).toBe('refused')
    expect(reload).not.toHaveBeenCalled()
  })

  it('fails closed when the storage accessor itself throws', () => {
    const reload = vi.fn()
    const guard = createReloadGuard({
      storage: () => {
        throw new Error('SecurityError')
      },
      now: () => 1,
      reload,
    })

    expect(guard.request(RELEASE)).toBe('refused')
    expect(reload).not.toHaveBeenCalled()
  })
})
