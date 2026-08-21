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
  version: null,
  issuedAt: null,
  graceExpiresAt: null,
}

const LIVE_TOKEN: PortalTokenStatus = {
  hasActiveToken: true,
  version: 3,
  issuedAt: '2026-01-04T12:00:00Z',
  graceExpiresAt: null,
}

/** In-session URL: returned by issue/rotate, gone after a reload. */
const PUBLIC_URL = 'https://portal.example.com/p/9f3c'

describe('derivePortalShareView — precedence between the three sources of truth', () => {
  it('offers rotate/revoke for a token only tokenStatus knows about (post-reload)', () => {
    // The mitigation path for a leaked link: no URL in memory, but the portal
    // demonstrably has a live token, so the actions MUST still be reachable.
    const view = derivePortalShareView({
      canManage: true,
      revoked: false,
      publicUrl: null,
      tokenStatus: LIVE_TOKEN,
    })

    expect(view.showActions).toBe(true)
    expect(view.showIssueForm).toBe(false)
    // Nothing to reveal, so the tab says a link exists instead of showing it.
    expect(view.showActiveLinkNotice).toBe(true)
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
    // The reveal is rendering the URL; the notice would duplicate it.
    expect(view.showActiveLinkNotice).toBe(false)
  })

  it('lets an in-session revoke outrank a tokenStatus that still claims a token', () => {
    const view = derivePortalShareView({
      canManage: true,
      revoked: true,
      publicUrl: null,
      tokenStatus: LIVE_TOKEN,
    })

    expect(view.showRevokedNotice).toBe(true)
    expect(view.showActions).toBe(false)
    expect(view.showActiveLinkNotice).toBe(false)
    // The only way forward from a revoke is to issue a fresh link.
    expect(view.showIssueForm).toBe(true)
  })

  it('never claims a revoke that did not happen when there is simply no token', () => {
    const view = derivePortalShareView({
      canManage: true,
      revoked: false,
      publicUrl: null,
      tokenStatus: NO_TOKEN,
    })

    expect(view.showIssueForm).toBe(true)
    expect(view.showRevokedNotice).toBe(false)
    expect(view.showActions).toBe(false)
    expect(view.showActiveLinkNotice).toBe(false)
  })

  it('tells a viewer a link exists but offers no way to change it', () => {
    const viewer = derivePortalShareView({
      canManage: false,
      revoked: false,
      publicUrl: null,
      tokenStatus: LIVE_TOKEN,
    })

    expect(viewer.showViewOnlyNotice).toBe(true)
    expect(viewer.showIssueForm).toBe(false)
    expect(viewer.showActions).toBe(false)
    // Read-only is not blind: the notice is informational, not an affordance.
    expect(viewer.showActiveLinkNotice).toBe(true)

    const manager = derivePortalShareView({
      canManage: true,
      revoked: false,
      publicUrl: null,
      tokenStatus: LIVE_TOKEN,
    })
    expect(manager.showViewOnlyNotice).toBe(false)
  })

  it('keeps issue and manage mutually exclusive, and both behind canManage', () => {
    // Whatever the three sources say, the tab must never ask the user to issue a
    // link while also offering to rotate one, and neither may appear without the
    // capability. Exhaustive over the reachable input space.
    for (const canManage of [true, false]) {
      for (const revoked of [true, false]) {
        for (const publicUrl of [PUBLIC_URL, null]) {
          for (const tokenStatus of [LIVE_TOKEN, NO_TOKEN]) {
            const view = derivePortalShareView({
              canManage,
              revoked,
              publicUrl,
              tokenStatus,
            })
            const where = JSON.stringify({
              canManage,
              revoked,
              publicUrl,
              hasActiveToken: tokenStatus.hasActiveToken,
            })

            expect(view.showIssueForm && view.showActions, where).toBe(false)
            if (view.showIssueForm || view.showActions)
              expect(canManage, where).toBe(true)
            // The reveal already shows the URL when there is one.
            if (view.showActiveLinkNotice) expect(publicUrl, where).toBeNull()
          }
        }
      }
    }
  })
})

describe('derivePortalShareView — active-link summary', () => {
  it('reads "version N, issued <date>" when the token carries both', () => {
    expect(
      derivePortalShareView({
        canManage: true,
        revoked: false,
        publicUrl: null,
        tokenStatus: LIVE_TOKEN,
      }).activeLinkDetail,
    ).toBe('version 3, issued Jan 4, 2026')
  })

  it('drops whichever half the token lacks instead of naming a null', () => {
    const detail = (tokenStatus: PortalTokenStatus) =>
      derivePortalShareView({
        canManage: true,
        revoked: false,
        publicUrl: null,
        tokenStatus,
      }).activeLinkDetail

    expect(detail({ ...LIVE_TOKEN, version: null })).toBe('issued Jan 4, 2026')
    expect(detail({ ...LIVE_TOKEN, issuedAt: null })).toBe('version 3')
    expect(detail({ ...LIVE_TOKEN, version: null, issuedAt: null })).toBe('')
  })

  it('drops an unparseable issue date rather than printing "Invalid Date"', () => {
    const detail = derivePortalShareView({
      canManage: true,
      revoked: false,
      publicUrl: null,
      tokenStatus: { ...LIVE_TOKEN, issuedAt: 'not-a-timestamp' },
    }).activeLinkDetail

    expect(detail).toBe('version 3')
    expect(detail).not.toContain('Invalid')
  })

  it('names the UTC calendar day, not the reader time zone (hydration parity)', () => {
    // The server renders this string too; if the two disagree by a day the
    // hydration mismatch surfaces as an error, so both instants below straddle
    // midnight UTC and must resolve to their UTC day in every runner zone.
    const cases = [
      // 01:30 the next day east of UTC.
      { issuedAt: '2026-01-04T23:30:00Z', detail: 'version 3, issued Jan 4, 2026' },
      // 20:00 the previous day west of UTC.
      { issuedAt: '2026-01-05T01:00:00Z', detail: 'version 3, issued Jan 5, 2026' },
    ]

    for (const { issuedAt, detail } of cases) {
      expect(
        derivePortalShareView({
          canManage: true,
          revoked: false,
          publicUrl: null,
          tokenStatus: { ...LIVE_TOKEN, issuedAt },
        }).activeLinkDetail,
        issuedAt,
      ).toBe(detail)
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
    expect(graceLabel('2026-02-10T09:00:00Z')).toBe('Feb 10, 2026')
    // A malformed timestamp hides the row; it must not render "Invalid Date".
    expect(graceLabel('soon')).toBeNull()
  })
})
