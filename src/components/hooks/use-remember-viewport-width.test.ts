import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rememberViewportWidth, viewportCookie } from './use-remember-viewport-width'
import { VIEWPORT_COOKIE, viewportHintFromRequest } from './viewport-hint'

describe('viewportCookie', () => {
  it('is a site-wide, long-lived, same-site cookie', () => {
    expect(viewportCookie(390, false)).toBe(
      `${VIEWPORT_COOKIE}=390; Path=/; Max-Age=31536000; SameSite=Lax`,
    )
  })

  it('is Secure on an https origin', () => {
    expect(viewportCookie(390, true)).toBe(
      `${VIEWPORT_COOKIE}=390; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    )
  })

  it('writes the width the server reads back', () => {
    const [pair] = viewportCookie(1440, true).split(';')

    expect(viewportHintFromRequest({ cookie: pair }).width).toBe(1440)
  })
})

function resizableWindow(width: number) {
  const listeners = new Set<() => void>()
  return {
    innerWidth: width,
    addEventListener: (_type: 'resize', listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: 'resize', listener: () => void) =>
      listeners.delete(listener),
    resizeTo(next: number) {
      this.innerWidth = next
      listeners.forEach((listener) => listener())
    },
    listeners,
  }
}

describe('rememberViewportWidth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the width as soon as the app mounts', () => {
    const setCookie = vi.fn()

    rememberViewportWidth(resizableWindow(390), setCookie, true)

    expect(setCookie).toHaveBeenCalledExactlyOnceWith(viewportCookie(390, true))
  })

  it('writes once when a window drag settles, with the final width', () => {
    const view = resizableWindow(1440)
    const setCookie = vi.fn()
    rememberViewportWidth(view, setCookie, false)
    setCookie.mockClear()

    view.resizeTo(1200)
    view.resizeTo(900)
    vi.advanceTimersByTime(200)
    view.resizeTo(820)
    expect(setCookie).not.toHaveBeenCalled()

    vi.advanceTimersByTime(250)
    expect(setCookie).toHaveBeenCalledExactlyOnceWith(viewportCookie(820, false))
  })

  it('does not rewrite a width it already wrote', () => {
    const view = resizableWindow(390)
    const setCookie = vi.fn()
    rememberViewportWidth(view, setCookie, false)

    view.resizeTo(390)
    vi.runAllTimers()

    expect(setCookie).toHaveBeenCalledOnce()
  })

  it('stops listening, and drops a pending write, when the app unmounts', () => {
    const view = resizableWindow(390)
    const setCookie = vi.fn()
    const stop = rememberViewportWidth(view, setCookie, false)

    view.resizeTo(820)
    stop()
    vi.runAllTimers()

    expect(setCookie).toHaveBeenCalledOnce()
    expect(view.listeners.size).toBe(0)
  })
})
