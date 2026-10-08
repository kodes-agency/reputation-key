import { describe, expect, it } from 'vitest'
import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import { workspaceStatusProblem } from './portal-workspace-status'

const CODE: PortalTokenStatus = {
  hasActiveToken: true,
  qualifiedScanReady: true,
  version: 2,
  issuedAt: '2026-09-01T10:00:00.000Z',
  graceExpiresAt: null,
  addressRecoverable: true,
  madeBy: null,
}
const NO_CODE: PortalTokenStatus = {
  ...CODE,
  hasActiveToken: false,
  qualifiedScanReady: false,
  version: null,
  issuedAt: null,
  addressRecoverable: false,
}

const problem = (over: Partial<Parameters<typeof workspaceStatusProblem>[0]> = {}) =>
  workspaceStatusProblem({
    publicationState: 'published',
    propertyAvailable: true,
    hasLiveVersion: true,
    token: CODE,
    ...over,
  })

describe('workspaceStatusProblem — what stops guests opening a live portal', () => {
  it('says nothing for a live portal guests can open', () => {
    expect(problem()).toBeNull()
  })

  it('says there is no working code, and leads to Share', () => {
    expect(problem({ token: NO_CODE })).toEqual({ text: 'no working code', fix: 'share' })
  })

  it('names the most blocking problem first, as the Portals list ranks them', () => {
    expect(problem({ propertyAvailable: false, token: NO_CODE })).toEqual({
      text: 'property unavailable',
      fix: null,
    })
    expect(problem({ hasLiveVersion: false, token: NO_CODE })).toEqual({
      text: 'no version guests can open',
      fix: 'review',
    })
  })

  // An older code works for guests: the list gives it its own line, not an issue.
  it('does not count an older code as a problem', () => {
    expect(problem({ token: { ...CODE, qualifiedScanReady: false } })).toBeNull()
  })

  it.each(['draft', 'disabled', 'archived'] as const)(
    'adds nothing to a %s portal, whose status already says guests cannot open it',
    (publicationState) => {
      expect(problem({ publicationState, token: NO_CODE })).toBeNull()
    },
  )
})
