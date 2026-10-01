// Share-tab rules once a code's address is sealed (round 4, slice 33): when the
// manager can download it again, when the reveal-once warning goes, and what
// "made" says for an address that was fetched rather than made.

import { describe, it, expect } from 'vitest'
import { derivePortalShareView } from './portal-share-state'
import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'

const LIVE: PortalTokenStatus = {
  hasActiveToken: true,
  qualifiedScanReady: true,
  version: 3,
  issuedAt: '2026-01-04T12:00:00Z',
  graceExpiresAt: null,
  addressRecoverable: false,
}
const RECOVERABLE: PortalTokenStatus = { ...LIVE, addressRecoverable: true }
const NONE: PortalTokenStatus = {
  ...LIVE,
  hasActiveToken: false,
  version: null,
  issuedAt: null,
}
const URL_IN_MEMORY = 'https://portal.example.com/p/9f3c?accessArtifact=a'

const view = (overrides: Partial<Parameters<typeof derivePortalShareView>[0]>) =>
  derivePortalShareView({
    canManage: true,
    revoked: false,
    publicUrl: null,
    tokenStatus: LIVE,
    ...overrides,
  })

describe('derivePortalShareView — download again', () => {
  it('offers it to a manager when the live code was sealed and its key is still held', () => {
    expect(view({ tokenStatus: RECOVERABLE }).canDownloadAgain).toBe(true)
  })

  it('does not offer it without a sealed address, to a viewer, or after a stop', () => {
    expect(view({ tokenStatus: LIVE }).canDownloadAgain).toBe(false)
    expect(view({ tokenStatus: RECOVERABLE, canManage: false }).canDownloadAgain).toBe(
      false,
    )
    expect(view({ tokenStatus: RECOVERABLE, revoked: true }).canDownloadAgain).toBe(false)
    expect(view({ tokenStatus: NONE }).canDownloadAgain).toBe(false)
  })

  it('shows the address row after a reload only when it can be fetched', () => {
    expect(view({ tokenStatus: RECOVERABLE }).showAddressRow).toBe(true)
    // No keyring: after a reload the address is gone and there is nothing to show.
    expect(view({ tokenStatus: LIVE }).showAddressRow).toBe(false)
    // Fresh from make or replace, the address is on screen either way.
    expect(view({ tokenStatus: LIVE, publicUrl: URL_IN_MEMORY }).showAddressRow).toBe(
      true,
    )
  })

  it('keeps the save-now warning for an address that cannot be fetched again', () => {
    expect(view({ publicUrl: URL_IN_MEMORY, tokenStatus: LIVE }).showSaveWarning).toBe(
      true,
    )
    expect(view({ publicUrl: URL_IN_MEMORY, tokenStatus: NONE }).showSaveWarning).toBe(
      true,
    )
  })

  it('drops the save-now warning once the address can be downloaded again', () => {
    expect(
      view({ publicUrl: URL_IN_MEMORY, tokenStatus: RECOVERABLE }).showSaveWarning,
    ).toBe(false)
    // Nothing on screen to warn about.
    expect(view({ tokenStatus: RECOVERABLE }).showSaveWarning).toBe(false)
  })
})

describe('derivePortalShareView — a code made or replaced in this session', () => {
  it('trusts the result over a token status the detail refetch has not caught up with', () => {
    // Made with a keyring while tokenStatus (read before) still says it is not recoverable.
    const made = view({
      publicUrl: URL_IN_MEMORY,
      tokenStatus: LIVE,
      addressRecoverable: true,
    })
    expect(made.showSaveWarning).toBe(false)
    expect(made.canDownloadAgain).toBe(true)
  })

  it('warns for a replacement made without a keyring even if the old code was sealed', () => {
    const replaced = view({
      publicUrl: URL_IN_MEMORY,
      tokenStatus: RECOVERABLE,
      addressRecoverable: false,
    })
    expect(replaced.showSaveWarning).toBe(true)
    expect(replaced.canDownloadAgain).toBe(false)
  })

  it('falls back to the token status when the address was fetched again', () => {
    expect(
      view({ publicUrl: URL_IN_MEMORY, tokenStatus: RECOVERABLE }).showSaveWarning,
    ).toBe(false)
  })
})

describe('derivePortalShareView — an address that was fetched, not made', () => {
  const now = new Date('2026-09-30T23:30:00Z')

  it('says when the code was made, not today', () => {
    const fetched = view({
      publicUrl: URL_IN_MEMORY,
      tokenStatus: RECOVERABLE,
      addressRevealed: true,
      now,
    })
    expect(fetched.madeLabel).toBe('4 Jan 2026')
  })

  it('still says today for a code made in this session', () => {
    const made = view({ publicUrl: URL_IN_MEMORY, tokenStatus: RECOVERABLE, now })
    expect(made.madeLabel).toBe('30 Sept 2026')
  })
})
