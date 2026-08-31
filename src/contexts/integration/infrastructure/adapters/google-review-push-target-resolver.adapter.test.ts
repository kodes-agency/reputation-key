import { describe, expect, it, vi } from 'vitest'
import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_PROVIDER_FIXTURES_V1,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { createGoogleReviewPushTargetResolver } from './google-review-push-target-resolver.adapter'

const organizationId = 'org-push-resolver' as OrganizationId
const propertyId = '00000000-0000-4000-8000-000000000021' as PropertyId
const connectionId = '00000000-0000-4000-8000-000000000022' as GoogleConnectionId
const accountId =
  GOOGLE_PROVIDER_FIXTURES_V1['google-review-primary'].expectedSegments.accountId
const locationId =
  GOOGLE_PROVIDER_FIXTURES_V1['google-review-primary'].expectedSegments.locationId
const referenceRef = `v1.${Buffer.alloc(32, 8).toString('base64url')}`
const binding = {
  organizationId,
  propertyId,
  state: 'active',
  connectionId,
  accountId,
  locationId,
  sourceEpoch: 4,
  lifecycleState: 'active',
  deletedAt: null,
} as const
const input = { organizationId, propertyId, connectionId, sourceEpoch: 4, referenceRef }

describe('Google review push target resolver adapter', () => {
  it('binds the opaque target to a fresh current Property Google binding', async () => {
    const resolve = vi.fn(async () => ({
      ok: true as const,
      target: {
        locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
        reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
      },
    }))
    const resolver = createGoogleReviewPushTargetResolver({
      readBinding: async () => binding,
      references: { resolve },
    })

    await expect(resolver.resolve(input)).resolves.toEqual({
      status: 'found',
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    })
    expect(resolve).toHaveBeenCalledWith({
      scope: {
        organizationId,
        propertyId,
        connectionId,
        sourceEpoch: 4,
      },
      referenceRef,
    })
  })

  it('returns obsolete when the Property source epoch or connection changed', async () => {
    const resolve = vi.fn()
    const resolver = createGoogleReviewPushTargetResolver({
      readBinding: async () => ({ ...binding, sourceEpoch: 5 }),
      references: { resolve },
    })
    await expect(resolver.resolve(input)).resolves.toEqual({ status: 'obsolete' })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('reconstructs the current location for full reconciliation when the reference expired', async () => {
    const resolver = createGoogleReviewPushTargetResolver({
      readBinding: async () => binding,
      references: { resolve: async () => ({ ok: false, code: 'not_found' }) },
    })
    await expect(resolver.resolve(input)).resolves.toEqual({
      status: 'reconcile',
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reason: 'reference_expired',
    })
  })

  it('uses the same recovery path when ingress intentionally stored no target reference', async () => {
    const resolve = vi.fn()
    const resolver = createGoogleReviewPushTargetResolver({
      readBinding: async () => binding,
      references: { resolve },
    })
    await expect(resolver.resolve({ ...input, referenceRef: null })).resolves.toEqual({
      status: 'reconcile',
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reason: 'reference_missing',
    })
    expect(resolve).not.toHaveBeenCalled()
  })
})
