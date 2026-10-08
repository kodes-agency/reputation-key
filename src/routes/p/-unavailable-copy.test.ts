import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deV2 } from '#/components/features/guest/public-portal/language-packs/de-v2'

const { getUnavailableGuestLocale } = vi.hoisted(() => ({
  getUnavailableGuestLocale: vi.fn(),
}))
vi.mock('#/contexts/guest/server/unavailable-locale', () => ({
  getUnavailableGuestLocale,
}))

import { loadUnavailableCopy } from './-unavailable-copy'

describe('loadUnavailableCopy — the unavailable page in the visitor’s language', () => {
  // A block body: `mockReset` returns the mock, which Vitest would run as a teardown.
  beforeEach(() => {
    getUnavailableGuestLocale.mockReset()
  })

  it('gives the words of the language the browser asks for', async () => {
    getUnavailableGuestLocale.mockResolvedValue({ locale: 'de' })
    await expect(loadUnavailableCopy()).resolves.toEqual({
      locale: 'de',
      title: deV2.copy.unavailableTitle,
      body: deV2.copy.unavailableBody,
      retry: deV2.copy.unavailableRetry,
    })
  })

  // The page draws English by itself: nothing to load.
  it('gives null for English', async () => {
    getUnavailableGuestLocale.mockResolvedValue({ locale: 'en' })
    await expect(loadUnavailableCopy()).resolves.toBeNull()
  })

  it('leaves the English page when the server cannot answer', async () => {
    getUnavailableGuestLocale.mockRejectedValue(new Error('offline'))
    await expect(loadUnavailableCopy()).resolves.toBeNull()
  })
})
