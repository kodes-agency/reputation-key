// Share-tab rules: which of the three sources of truth about a public portal
// link wins when they disagree, and what the notices around it are allowed to say.
//
// The Share tab reads three overlapping answers to "is a link live?":
//
//   tokenStatus  durable, from getPortal (C2) — survives a reload
//   publicUrl    in-session only; issue/rotate return the raw URL once
//   revoked      in-session only; set by a revoke the detail query has not seen
//
// Deriving the affordances from `publicUrl` alone left a leaked QR permanently
// unrevocable after a reload (there was no URL in memory, so no rotate/revoke
// button); trusting `tokenStatus` alone resurrects the buttons for a link the
// user just revoked, because that query has not refetched. The precedence
// between the three is the rule worth pinning, so these tests drive each source
// into conflict with the others rather than checking one flag at a time.

import { describe, it, expect } from 'vitest'
import { derivePortalShareView } from './portal-share-state'
import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'

const NO_TOKEN: PortalTokenStatus = {
  hasActiveToken: false,
  qualifiedScanReady: false,
  version: null,
  issuedAt: null,
  graceExpiresAt: null,
}

const LIVE_TOKEN: PortalTokenStatus = {
  hasActiveToken: true,
  qualifiedScanReady: true,
  version: 3,
  issuedAt: '2026-01-04T12:00:00Z',
  graceExpiresAt: null,
}

/** In-session URL: returned by issue/rotate, gone after a reload. */
const PUBLIC_URL = 'https://portal.example.com/p/9f3c'

type ShareViewInput = Parameters<typeof derivePortalShareView>[0]

/**
 * Every combination of the three sources of truth, built once at module scope so
 * the exhaustive test below reads as the invariant it asserts rather than as four
 * levels of loop. `publicUrl` and `tokenStatus` each contribute their only two
 * meaningful values: present, and absent.
 */
const REACHABLE_INPUTS: readonly ShareViewInput[] = buildReachableInputs()

function buildReachableInputs(): readonly ShareViewInput[] {
  const inputs: ShareViewInput[] = []
  for (const canManage of [true, false])
    for (const revoked of [true, false])
      for (const publicUrl of [PUBLIC_URL, null])
        for (const tokenStatus of [LIVE_TOKEN, NO_TOKEN])
          inputs.push({ canManage, revoked, publicUrl, tokenStatus })
  return inputs
}

describe('derivePortalShareView — precedence between the three sources of truth', () => {
  it('offers replace and stop for a code only tokenStatus knows about (post-reload)', () => {
    // The mitigation path for a leaked code: no address in memory, but the portal
    // demonstrably has a live token, so the actions MUST still be reachable.
    const view = derivePortalShareView({
      canManage: true,
      revoked: false,
      publicUrl: null,
      tokenStatus: LIVE_TOKEN,
    })

    expect(view.showActions).toBe(true)
    expect(view.showIssueForm).toBe(false)
    // The code block says a code exists; there is no address to show.
    expect(view.showCode).toBe(true)
    expect(view.showAddress).toBe(false)
    expect(view.showRevokedNotice).toBe(false)
  })

  it('lets an in-session issue outrun a tokenStatus that has not refetched', () => {
    const view = derivePortalShareView({
      canManage: true,
      revoked: false,
      publicUrl: PUBLIC_URL,
      tokenStatus: NO_TOKEN,
    })

    expect(view.showActions).toBe(true)
    expect(view.showIssueForm).toBe(false)
    expect(view.showCode).toBe(true)
    expect(view.showAddress).toBe(true)
  })

  it('lets an in-session stop outrank a tokenStatus that still claims a token', () => {
    const view = derivePortalShareView({
      canManage: true,
      revoked: true,
      publicUrl: null,
      tokenStatus: LIVE_TOKEN,
    })

    expect(view.showRevokedNotice).toBe(true)
    expect(view.showActions).toBe(false)
    expect(view.showCode).toBe(false)
    // The only way forward from a stop is to make a fresh code.
    expect(view.showIssueForm).toBe(true)
  })

  it('never claims a stop that did not happen when there is simply no token', () => {
    const view = derivePortalShareView({
      canManage: true,
      revoked: false,
      publicUrl: null,
      tokenStatus: NO_TOKEN,
    })

    expect(view.showIssueForm).toBe(true)
    expect(view.showRevokedNotice).toBe(false)
    expect(view.showActions).toBe(false)
    expect(view.showCode).toBe(false)
  })

  it('shows a viewer the code exists but offers no way to change it', () => {
    const viewer = derivePortalShareView({
      canManage: false,
      revoked: false,
      publicUrl: null,
      tokenStatus: LIVE_TOKEN,
    })

    expect(viewer.showViewOnlyNotice).toBe(true)
    expect(viewer.showIssueForm).toBe(false)
    expect(viewer.showActions).toBe(false)
    // Read-only is not blind: the code block is informational, not an affordance.
    expect(viewer.showCode).toBe(true)

    const manager = derivePortalShareView({
      canManage: true,
      revoked: false,
      publicUrl: null,
      tokenStatus: LIVE_TOKEN,
    })
    expect(manager.showViewOnlyNotice).toBe(false)
  })

  it('keeps make and manage mutually exclusive, and both behind canManage', () => {
    // Whatever the three sources say, the tab must never ask the user to make a
    // code while also offering to replace one, and neither may appear without
    // the capability. Exhaustive over the reachable input space.
    for (const input of REACHABLE_INPUTS) {
      const view = derivePortalShareView(input)
      const where = JSON.stringify({
        canManage: input.canManage,
        revoked: input.revoked,
        publicUrl: input.publicUrl,
        hasActiveToken: input.tokenStatus.hasActiveToken,
      })

      expect(view.showIssueForm && view.showActions, where).toBe(false)
      if (view.showIssueForm || view.showActions)
        expect(input.canManage, where).toBe(true)
      // An address is shown only for a code that is shown, and only when one is
      // in memory.
      if (view.showAddress) {
        expect(view.showCode, where).toBe(true)
        expect(input.publicUrl, where).not.toBeNull()
      }
      // A code is either on screen or there is a way to make one (for a manager).
      if (input.canManage) expect(view.showCode || view.showIssueForm, where).toBe(true)
    }
  })
})

describe('derivePortalShareView — when the code was made', () => {
  const madeLabel = (tokenStatus: PortalTokenStatus) =>
    derivePortalShareView({
      canManage: true,
      revoked: false,
      publicUrl: null,
      tokenStatus,
    }).madeLabel

  it('reads the day the code was made', () => {
    expect(madeLabel(LIVE_TOKEN)).toBe('4 Jan 2026')
  })

  it('is empty rather than "Invalid Date" or a null', () => {
    expect(madeLabel({ ...LIVE_TOKEN, issuedAt: null })).toBeNull()
    expect(madeLabel({ ...LIVE_TOKEN, issuedAt: 'not-a-timestamp' })).toBeNull()
  })

  it('names the UTC calendar day, not the reader time zone (hydration parity)', () => {
    // The server renders this string too; if the two disagree by a day the
    // hydration mismatch surfaces as an error, so both instants below straddle
    // midnight UTC and must resolve to their UTC day in every runner zone.
    const cases = [
      // 01:30 the next day east of UTC.
      { issuedAt: '2026-01-04T23:30:00Z', label: '4 Jan 2026' },
      // 20:00 the previous day west of UTC.
      { issuedAt: '2026-01-05T01:00:00Z', label: '5 Jan 2026' },
    ]

    for (const { issuedAt, label } of cases) {
      expect(madeLabel({ ...LIVE_TOKEN, issuedAt }), issuedAt).toBe(label)
    }
  })

  it('labels a grace window only while one is set', () => {
    const graceLabel = (graceExpiresAt: string | null) =>
      derivePortalShareView({
        canManage: true,
        revoked: false,
        publicUrl: null,
        tokenStatus: { ...LIVE_TOKEN, graceExpiresAt },
      }).graceLabel

    expect(graceLabel(null)).toBeNull()
    expect(graceLabel('2026-02-10T09:00:00Z')).toBe('10 Feb 2026')
    // A malformed timestamp hides the row; it must not render "Invalid Date".
    expect(graceLabel('soon')).toBeNull()
  })
})
