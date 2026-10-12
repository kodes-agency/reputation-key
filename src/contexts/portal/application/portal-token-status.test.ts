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
        addressKeyVersion: null,
        issuedBy: null,
      }),
    ).toEqual({
      hasActiveToken: true,
      qualifiedScanReady: true,
      version: 3,
      issuedAt: '2026-09-01T10:00:00.000Z',
      graceExpiresAt: null,
      addressRecoverable: false,
      madeBy: null,
    })
  })

  it('carries the end of the grace window as an ISO string', () => {
    expect(
      toPortalTokenStatus({
        version: 2,
        issuedAt: ISSUED,
        gracePeriodEnds: GRACE_END,
        hasPublishedAccessArtifact: false,
        addressKeyVersion: null,
        issuedBy: null,
      }),
    ).toMatchObject({
      hasActiveToken: true,
      qualifiedScanReady: false,
      graceExpiresAt: '2026-10-01T10:00:00.000Z',
    })
  })

  describe('addressRecoverable', () => {
    const sealed = {
      version: 1,
      issuedAt: ISSUED,
      gracePeriodEnds: null,
      hasPublishedAccessArtifact: true,
      addressKeyVersion: 2,
      issuedBy: null,
    }

    it('is on when the code was sealed and the keyring still holds that key', () => {
      const status = toPortalTokenStatus(sealed, (version) => version === 2)
      expect(status.addressRecoverable).toBe(true)
    })

    it('is off when the key that sealed the code was retired', () => {
      expect(
        toPortalTokenStatus(sealed, (version) => version === 3).addressRecoverable,
      ).toBe(false)
    })

    it('is off when the code holds no sealed address', () => {
      const status = toPortalTokenStatus(
        { ...sealed, addressKeyVersion: null },
        () => true,
      )
      expect(status.addressRecoverable).toBe(false)
    })

    it('is off when no keyring is configured, however the code was sealed', () => {
      expect(toPortalTokenStatus(sealed).addressRecoverable).toBe(false)
    })

    it('is off for a code with no published markers, which could not be rebuilt', () => {
      const status = toPortalTokenStatus(
        { ...sealed, hasPublishedAccessArtifact: false },
        () => true,
      )
      expect(status.addressRecoverable).toBe(false)
    })
  })

  describe('madeBy', () => {
    const summary = {
      version: 1,
      issuedAt: ISSUED,
      gracePeriodEnds: null,
      hasPublishedAccessArtifact: true,
      addressKeyVersion: null,
      issuedBy: 'user-1',
    }

    it('carries the name the caller resolved for the issuer', () => {
      expect(toPortalTokenStatus(summary, () => false, 'Georgi Ivanov').madeBy).toBe(
        'Georgi Ivanov',
      )
    })

    it('is null when the issuer could not be named', () => {
      expect(toPortalTokenStatus(summary).madeBy).toBeNull()
    })
  })
})
