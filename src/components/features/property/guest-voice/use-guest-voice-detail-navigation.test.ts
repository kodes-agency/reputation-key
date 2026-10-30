import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { GuestVoiceDetailTarget } from '#/contexts/ai/application/public-api'
const refs = vi.hoisted(() => ({ items: [] as { current: unknown }[], cursor: 0 }))
vi.mock('react', () => ({
  useRef: (initial: unknown) => {
    const index = refs.cursor++
    return refs.items[index] ?? (refs.items[index] = { current: initial })
  },
}))
import { useGuestVoiceDetailNavigation } from './use-guest-voice-detail-navigation'
class Element {
  dataset = { detailFocus: 'linked-health' }
  isConnected = true
  textContent = 'Room'
  focus = vi.fn()
  closest = () => ({ getAttribute: () => 'fix-band' })
  querySelector = () => null
}
const issue = { kind: 'issue', issueId: 'a', sense: 'complaint' } as const
const concern = { kind: 'concern', issueId: 'a', reason: 'health' } as const
let active: Element
let band: Element
const scrollTo = vi.fn()
function NavigationHarness(target: GuestVoiceDetailTarget | null, change = vi.fn()) {
  refs.cursor = 0
  return useGuestVoiceDetailNavigation(target, change)
}
beforeEach(() => {
  refs.items = []
  refs.cursor = 0
  active = new Element()
  band = new Element()
  scrollTo.mockClear()
  vi.stubGlobal('HTMLElement', Element)
  vi.stubGlobal('document', {
    activeElement: active,
    getElementById: () => band,
    querySelector: () => band,
  })
  vi.stubGlobal('window', { scrollY: 520, scrollTo })
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback())
  vi.stubGlobal('CSS', { escape: (s: string) => s })
})
afterEach(() => vi.unstubAllGlobals())
describe('detail navigation snapshots', () => {
  it('opens, restores the ancestor scroll and focus on Back, then replaces on Close', () => {
    const change = vi.fn()
    NavigationHarness(null, change).open(issue)
    expect(change).toHaveBeenLastCalledWith(issue)
    let nav = NavigationHarness(issue, change)
    const focus = new Element()
    const body = { scrollTop: 0, querySelector: vi.fn(() => focus) }
    Object.assign(nav.scrollRef, { current: body })
    nav.ready('Room')
    body.scrollTop = 380
    nav.open(concern)
    expect(change).toHaveBeenLastCalledWith(concern, { replace: true })
    nav = NavigationHarness(concern, change)
    nav.ready('Health')
    expect(nav.backLabel()).toBe('Room')
    body.scrollTop = 200
    nav.back()
    expect(change).toHaveBeenLastCalledWith(issue, { replace: true })
    nav = NavigationHarness(issue, change)
    nav.ready('Room')
    expect(body.scrollTop).toBe(380)
    expect(focus.focus).toHaveBeenCalledWith({ preventScroll: true })
    nav.open(null)
    expect(change).toHaveBeenLastCalledWith(null, { replace: true })
    nav.restorePage()
    expect(scrollTo).toHaveBeenCalledWith({ top: 520 })
    expect(active.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
  it('restores the original band when the opener disappears, and clears its trail', () => {
    NavigationHarness(null).open(issue)
    active.isConnected = false
    const nav = NavigationHarness(issue)
    nav.restorePage()
    expect(band.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(NavigationHarness(concern).backLabel()).toBeNull()
  })
  it('does not invent a Back step for a direct URL or a cycle to an ancestor', () => {
    expect(NavigationHarness(issue).backLabel()).toBeNull()
    let nav = NavigationHarness(issue)
    nav.ready('Room')
    nav.open(concern)
    nav = NavigationHarness(concern)
    nav.ready('Health')
    nav.open(issue)
    expect(NavigationHarness(issue).backLabel()).toBeNull()
  })
})
