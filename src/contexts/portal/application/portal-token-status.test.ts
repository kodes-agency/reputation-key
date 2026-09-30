import { describe, expect, it } from 'vitest'
import { NO_ACTIVE_TOKEN, toPortalTokenStatus } from './portal-token-status'

const ISSUED = new Date('2026-09-01T10:00:00.000Z')
const GRACE_END = new Date('2026-10-01T10:00:00.000Z')

describe('toPortalTokenStatus', () => {
  it('says there is no active token when there is no summary', () => {
    expect(toPortalTokenStatus(null)).toEqual(NO_ACTIVE_TOKEN)
    expect(toPortalTokenStatus(undefined)).toEqual(NO_ACTIVE_TOKEN)
    expect(NO_ACTIVE_TOKEN.hasActiveToken).toBe(false)
  })

  it('projects an active token with no grace window', () => {
    expect(
      toPortalTokenStatus({
        version: 3,
        issuedAt: ISSUED,
        gracePeriodEnds: null,
        hasPublishedAccessArtifact: true,
      }),
    ).toEqual({
      hasActiveToken: true,
      qualifiedScanReady: true,
      version: 3,
      issuedAt: '2026-09-01T10:00:00.000Z',
      graceExpiresAt: null,
    })
  })

  it('carries the end of the grace window as an ISO string', () => {
    expect(
      toPortalTokenStatus({
        version: 2,
        issuedAt: ISSUED,
        gracePeriodEnds: GRACE_END,
        hasPublishedAccessArtifact: false,
      }),
    ).toMatchObject({
      hasActiveToken: true,
      qualifiedScanReady: false,
      graceExpiresAt: '2026-10-01T10:00:00.000Z',
    })
  })
})
