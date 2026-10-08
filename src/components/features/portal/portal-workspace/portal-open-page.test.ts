import { describe, expect, it, vi } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import {
  deriveOpenPageMode,
  openablePageAddress,
  openLivePage,
  openPageErrorMessage,
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
const NO_TOKEN: PortalTokenStatus = {
  hasActiveToken: false,
  qualifiedScanReady: false,
  version: null,
  issuedAt: null,
  graceExpiresAt: null,
  addressRecoverable: false,
  madeBy: null,
}
const QR_ADDRESS = 'https://app.example.com/p/tok_123?accessArtifact=artifact-qr-1'

describe('deriveOpenPageMode', () => {
  const mode = (over: Partial<Parameters<typeof deriveOpenPageMode>[0]> = {}) =>
    deriveOpenPageMode({
      canUpdate: true,
      portalWriteEnabled: true,
      publicationState: 'published',
      tokenStatus: RECOVERABLE,
      activeTab: 'page',
      hasHeldAddress: false,
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

  // The header's status line says "no working code" and links to Share already.
  it('offers nothing when no code is live', () => {
    expect(mode({ tokenStatus: { ...RECOVERABLE, hasActiveToken: false } })).toBe(
      'hidden',
    )
  })

  // Guests cannot open any of these; the preview shows the draft.
  it.each(['draft', 'disabled', 'archived'] as const)(
    'offers nothing when the portal is %s, whatever its address',
    (publicationState) => {
      expect(mode({ publicationState, hasHeldAddress: true })).toBe('hidden')
      expect(mode({ publicationState })).toBe('hidden')
    },
  )

  it('opens a held address even when the keyring cannot give it again, or tokenStatus lags', () => {
    const unsealed = { ...RECOVERABLE, addressRecoverable: false }
    expect(mode({ tokenStatus: unsealed, hasHeldAddress: true })).toBe('reveal')
    expect(mode({ tokenStatus: NO_TOKEN, hasHeldAddress: true })).toBe('reveal')
  })

  // The route passes `portal.update` and the `portal.write` capability, the pair
  // the reveal's server function authorizes; each one alone must not offer it.
  it.each([
    ['without portal.update', { canUpdate: false }],
    ['without the portal.write capability', { portalWriteEnabled: false }],
  ])('is absent for someone %s', (_name, over) => {
    expect(mode(over)).toBe('hidden')
    expect(mode({ ...over, hasHeldAddress: true })).toBe('hidden')
  })

  it('is absent from the Share tab when it could only lead back to it', () => {
    const unsealed = { ...RECOVERABLE, addressRecoverable: false }
    expect(mode({ tokenStatus: unsealed, activeTab: 'share' })).toBe('hidden')
    expect(mode({ activeTab: 'share' })).toBe('reveal')
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

  it('opens a held address directly, with no tab to clean up and nothing disclosed', async () => {
    const { openBlankTab } = tabs()
    const reveal = vi.fn(async () => ({ publicUrl: QR_ADDRESS }))
    const openAddress = vi.fn()

    const outcome = await openLivePage({
      openBlankTab,
      reveal,
      heldAddress: QR_ADDRESS,
      openAddress,
    })

    expect(outcome).toBe('opened')
    expect(openAddress).toHaveBeenCalledWith('https://app.example.com/p/tok_123')
    expect(openBlankTab).not.toHaveBeenCalled()
    expect(reveal).not.toHaveBeenCalled()
  })

  it('reveals when the held address is not a page of this product', async () => {
    const { tab, openBlankTab } = tabs()
    const reveal = vi.fn(async () => ({ publicUrl: QR_ADDRESS }))

    const outcome = await openLivePage({
      openBlankTab,
      reveal,
      heldAddress: 'https://app.example.com/admin',
      openAddress: vi.fn(),
    })

    expect(outcome).toBe('opened')
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(tab.navigate).toHaveBeenCalledTimes(1)
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

describe('openPageErrorMessage', () => {
  const refusal = (code: string, status: number, message: string) =>
    new ServerFunctionError('PortalError', message, code, status)

  it('words a rate limit for opening the page, not for downloads', () => {
    const message = openPageErrorMessage(
      refusal('rate_limited', 429, 'Too many downloads. Please wait a little.'),
    )
    expect(message).toContain('open the page')
    expect(message).not.toMatch(/download/i)
  })

  it('sends a retired key or an unsealed code to Share, not to "download again"', () => {
    const message = openPageErrorMessage(
      refusal('address_unavailable', 422, 'This code cannot be downloaded again.'),
    )
    expect(message).toContain('Share')
    expect(message).not.toMatch(/download/i)
  })

  it('keeps the server sentence for any other refusal, and is generic for the rest', () => {
    expect(openPageErrorMessage(refusal('forbidden', 403, 'Not allowed.'))).toBe(
      'Not allowed.',
    )
    expect(openPageErrorMessage(new Error('boom'))).toBe(
      'Something went wrong. Try again.',
    )
  })
})
