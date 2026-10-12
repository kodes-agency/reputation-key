import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deV2 } from '#/components/features/guest/public-portal/language-packs/de-v2'

const { readBrowserLanguages } = vi.hoisted(() => ({
  readBrowserLanguages: vi.fn(),
}))
vi.mock('./-browser-languages', () => ({ readBrowserLanguages }))

import { loadUnavailableCopy } from './-unavailable-copy'

describe('loadUnavailableCopy — the unavailable page in the visitor’s language', () => {
  // A block body: `mockReset` returns the mock, which Vitest would run as a teardown.
  beforeEach(() => {
    readBrowserLanguages.mockReset()
  })

  it('gives the words of the language the browser asks for (Accept-Language on the server)', async () => {
    readBrowserLanguages.mockReturnValue('de-DE,de;q=0.9,en;q=0.5')
    await expect(loadUnavailableCopy()).resolves.toEqual({
      locale: 'de',
      title: deV2.copy.unavailableTitle,
      body: deV2.copy.unavailableBody,
      retry: deV2.copy.unavailableRetry,
    })
  })

  it('reads navigator.languages in the browser the same way', async () => {
    readBrowserLanguages.mockReturnValue(['de-AT', 'en-GB'])
    await expect(loadUnavailableCopy()).resolves.toMatchObject({ locale: 'de' })
  })

  // The page draws English by itself: nothing to load.
  it('gives null for English, and for a browser that asks for nothing the page can write', async () => {
    readBrowserLanguages.mockReturnValue('en-US,en;q=0.9')
    await expect(loadUnavailableCopy()).resolves.toBeNull()
    readBrowserLanguages.mockReturnValue('ja,zh;q=0.8')
    await expect(loadUnavailableCopy()).resolves.toBeNull()
  })

  it('leaves the English page when the language cannot be read', async () => {
    readBrowserLanguages.mockImplementation(() => {
      throw new Error('no request')
    })
    await expect(loadUnavailableCopy()).resolves.toBeNull()
  })
})
