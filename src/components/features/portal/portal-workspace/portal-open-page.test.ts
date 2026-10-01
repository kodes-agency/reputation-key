import { describe, expect, it, vi } from 'vitest'
import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import {
  deriveOpenPageMode,
  openablePageAddress,
  openLivePage,
  type BlankTab,
} from './portal-open-page'

const RECOVERABLE: PortalTokenStatus = {
  hasActiveToken: true,
  qualifiedScanReady: true,
  version: 2,
  issuedAt: '2026-09-01T10:00:00.000Z',
  graceExpiresAt: null,
  addressRecoverable: true,
  madeBy: null,
}
const QR_ADDRESS = 'https://app.example.com/p/tok_123?accessArtifact=artifact-qr-1'

describe('deriveOpenPageMode', () => {
  const mode = (over: Partial<Parameters<typeof deriveOpenPageMode>[0]> = {}) =>
    deriveOpenPageMode({
      canReveal: true,
      publicationState: 'published',
      tokenStatus: RECOVERABLE,
      ...over,
    })

  it('opens the page for a manager when it is live and its address can be had again', () => {
    expect(mode()).toBe('reveal')
  })

  it('points to Share while the address cannot be had again', () => {
    expect(mode({ tokenStatus: { ...RECOVERABLE, addressRecoverable: false } })).toBe(
      'share',
    )
  })

  it('points to Share when no code is live', () => {
    expect(mode({ tokenStatus: { ...RECOVERABLE, hasActiveToken: false } })).toBe('share')
  })

  it.each(['draft', 'disabled', 'archived'] as const)(
    'points to Share when the portal is %s, whatever its address',
    (publicationState) => {
      expect(mode({ publicationState })).toBe('share')
    },
  )

  it('points to Share for someone who cannot reveal an address', () => {
    expect(mode({ canReveal: false })).toBe('share')
  })
})

describe('openablePageAddress', () => {
  it('drops the QR marker, so opening the page is not counted as a scan', () => {
    expect(openablePageAddress({ publicUrl: QR_ADDRESS })).toBe(
      'https://app.example.com/p/tok_123',
    )
  })

  it.each([
    ['a javascript: address', 'javascript:alert(1)'],
    ['an address that is not a page', 'https://app.example.com/admin'],
    ['text that is not an address', 'not a url'],
    ['a non-web scheme', 'ftp://app.example.com/p/tok_123'],
  ])('refuses %s', (_name, publicUrl) => {
    expect(openablePageAddress({ publicUrl })).toBeNull()
  })
})

describe('openLivePage', () => {
  const tabs = () => {
    const tab: BlankTab = { navigate: vi.fn(), close: vi.fn() }
    return { tab, openBlankTab: vi.fn(() => tab) }
  }

  it('opens the tab first, reveals for the "show" purpose, then sends the tab to the page', async () => {
    const { tab, openBlankTab } = tabs()
    const order: string[] = []
    openBlankTab.mockImplementation(() => {
      order.push('open')
      return tab
    })
    const reveal = vi.fn(async (purpose: 'show') => {
      order.push(`reveal:${purpose}`)
      return { publicUrl: QR_ADDRESS }
    })

    const outcome = await openLivePage({ openBlankTab, reveal })

    expect(outcome).toBe('opened')
    expect(order).toEqual(['open', 'reveal:show'])
    expect(tab.navigate).toHaveBeenCalledWith('https://app.example.com/p/tok_123')
    expect(tab.close).not.toHaveBeenCalled()
  })

  it('discloses nothing when the browser will not open a tab', async () => {
    const reveal = vi.fn(async () => ({ publicUrl: QR_ADDRESS }))

    const outcome = await openLivePage({ openBlankTab: () => null, reveal })

    expect(outcome).toBe('popup_blocked')
    expect(reveal).not.toHaveBeenCalled()
  })

  it('closes the empty tab when the address is refused', async () => {
    const { tab, openBlankTab } = tabs()

    const outcome = await openLivePage({
      openBlankTab,
      reveal: async () => {
        throw new Error('rate limited')
      },
    })

    expect(outcome).toBe('failed')
    expect(tab.close).toHaveBeenCalledTimes(1)
    expect(tab.navigate).not.toHaveBeenCalled()
  })

  it('closes the empty tab when what came back is not a page address', async () => {
    const { tab, openBlankTab } = tabs()

    const outcome = await openLivePage({
      openBlankTab,
      reveal: async () => ({ publicUrl: 'javascript:alert(1)' }),
    })

    expect(outcome).toBe('unavailable')
    expect(tab.close).toHaveBeenCalledTimes(1)
    expect(tab.navigate).not.toHaveBeenCalled()
  })
})
