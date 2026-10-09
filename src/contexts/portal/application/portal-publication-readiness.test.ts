import { describe, expect, it } from 'vitest'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import {
  assertPortalHasOwnerAndAddress,
  portalHasPublicAddress,
} from './portal-publication-readiness'
import type { ResolvablePortalTokenSummary } from './ports/portal-token.repository'

const NOW = new Date('2026-10-09T09:00:00.000Z')

const code = (
  over: Partial<ResolvablePortalTokenSummary> = {},
): ResolvablePortalTokenSummary => ({
  version: 2,
  issuedAt: new Date('2026-08-01T09:00:00.000Z'),
  gracePeriodEnds: null,
  hasPublishedAccessArtifact: true,
  addressKeyVersion: null,
  issuedBy: null,
  ...over,
})

const depsWith = (summary: ResolvablePortalTokenSummary | null) => ({
  portalTokenRepo: { findResolvableSummaryForPortal: async () => summary },
})

describe('portalHasPublicAddress', () => {
  const ctx = buildTestAuthContext()
  const portal = buildTestPortal()

  it('is true for a code made with its QR and NFC markers', async () => {
    await expect(
      portalHasPublicAddress(depsWith(code()), ctx, portal, NOW),
    ).resolves.toBe(true)
  })

  it('is true for an older code made before the markers: guests still open the page with it', async () => {
    await expect(
      portalHasPublicAddress(
        depsWith(code({ hasPublishedAccessArtifact: false })),
        ctx,
        portal,
        NOW,
      ),
    ).resolves.toBe(true)
  })

  it('is false when no code resolves', async () => {
    await expect(portalHasPublicAddress(depsWith(null), ctx, portal, NOW)).resolves.toBe(
      false,
    )
  })
})

describe('assertPortalHasOwnerAndAddress', () => {
  const ctx = buildTestAuthContext()

  it('lets a portal with an older code and a responsible manager publish', async () => {
    await expect(
      assertPortalHasOwnerAndAddress(
        depsWith(code({ hasPublishedAccessArtifact: false })),
        ctx,
        buildTestPortal({ responsibilityNeededSince: null }),
        NOW,
      ),
    ).resolves.toBeUndefined()
  })

  it('refuses a portal with no code', async () => {
    await expect(
      assertPortalHasOwnerAndAddress(
        depsWith(null),
        ctx,
        buildTestPortal({ responsibilityNeededSince: null }),
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'token_unavailable' })
  })

  it('names the missing manager before the code', async () => {
    await expect(
      assertPortalHasOwnerAndAddress(
        depsWith(null),
        ctx,
        buildTestPortal({ responsibilityNeededSince: NOW }),
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'responsible_manager_ineligible' })
  })
})
