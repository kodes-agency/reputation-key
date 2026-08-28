import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_PROVIDER_FIXTURES_V1,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { PropertyLookup } from '../ports/property-lookup.port'
import type { GoogleReviewPushReferenceStore } from '../ports/google-review-push-reference.port'
import type { GbpReviewPushReceiptStore } from '../ports/gbp-review-push-receipt.port'
import { handleGbpNotification } from './handle-gbp-notification'

const ORGANIZATION_ID = 'org-google-push'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000001'
const CONNECTION_ID = '00000000-0000-4000-8000-000000000002'
const ACCOUNT_ID =
  GOOGLE_PROVIDER_FIXTURES_V1['google-review-primary'].expectedSegments.accountId
const LOCATION_ID =
  GOOGLE_PROVIDER_FIXTURES_V1['google-review-primary'].expectedSegments.locationId
const REFERENCE_REF = `v1.${Buffer.alloc(32, 7).toString('base64url')}`
const NOW = new Date('2026-08-27T08:00:00.000Z')

const PROPERTY: PropertyLookup = {
  id: PROPERTY_ID,
  organizationId: ORGANIZATION_ID,
  googleConnectionId: CONNECTION_ID,
  gbpAccountId: ACCOUNT_ID,
  gbpLocationId: LOCATION_ID,
  googleBindingState: 'active',
  sourceEpoch: 5,
}

function setup(
  input: Readonly<{
    property?: PropertyLookup | null
    publish?: Awaited<ReturnType<GoogleReviewPushReferenceStore['publish']>>
    receiptStatus?: 'recorded' | 'duplicate'
  }> = {},
) {
  const publish = vi.fn<GoogleReviewPushReferenceStore['publish']>(async () =>
    Promise.resolve(
      input.publish ?? ({ ok: true, referenceRef: REFERENCE_REF } as const),
    ),
  )
  const record = vi.fn<GbpReviewPushReceiptStore['record']>(async () => ({
    status: input.receiptStatus ?? 'recorded',
  }))
  const useCase = handleGbpNotification({
    propertyLookup: {
      findByGbpLocationId: async () =>
        input.property === undefined ? PROPERTY : input.property,
    },
    references: { publish, resolve: vi.fn() },
    receipts: { record },
    clock: () => NOW,
    logger: createMockLogger(),
  })
  return { useCase, publish, record }
}

const INPUT = Object.freeze({
  topic: 'projects/repkey/topics/gbp-reviews',
  messageId: 'message-1',
  notificationKind: 'NEW_REVIEW' as const,
  locationId: LOCATION_ID,
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
})

describe('handleGbpNotification', () => {
  it('persists a targeted identifier-only handoff instead of calling the review queue inline', async () => {
    const { useCase, publish, record } = setup()

    await expect(useCase(INPUT)).resolves.toEqual({
      accepted: true,
      duplicate: false,
      handoff: 'targeted',
      propertyId: PROPERTY_ID,
    })
    expect(publish).toHaveBeenCalledWith({
      scope: {
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        sourceEpoch: 5,
      },
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    })
    expect(record).toHaveBeenCalledTimes(1)
    const receipt = record.mock.calls[0]![0]
    expect(receipt).toMatchObject({
      topic: INPUT.topic,
      messageId: INPUT.messageId,
      notificationKind: 'NEW_REVIEW',
      resolvedPropertyId: PROPERTY_ID,
      outcome: 'accepted_targeted',
    })
    expect(receipt.event).toMatchObject({
      _tag: 'integration.google_review_push.accepted',
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      connectionId: CONNECTION_ID,
      sourceEpoch: 5,
      referenceRef: REFERENCE_REF,
    })
    expect(JSON.stringify(receipt.event)).not.toContain('accounts/')
  })

  it('acknowledges a duplicate without creating a second durable handoff', async () => {
    const { useCase } = setup({ receiptStatus: 'duplicate' })
    await expect(useCase(INPUT)).resolves.toMatchObject({
      accepted: true,
      duplicate: true,
      handoff: 'targeted',
    })
  })

  it('durably requests a full reconciliation when the short-lived reference store is unavailable', async () => {
    const { useCase, record } = setup({
      publish: { ok: false, code: 'unavailable' },
    })

    await expect(useCase(INPUT)).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      handoff: 'reconciliation',
    })
    expect(record.mock.calls[0]![0]).toMatchObject({
      outcome: 'accepted_reconciliation',
      event: { referenceRef: null },
    })
  })

  it('durably ignores an unimported location and emits no handoff fact', async () => {
    const { useCase, publish, record } = setup({ property: null })

    await expect(useCase(INPUT)).resolves.toEqual({
      accepted: true,
      duplicate: false,
      handoff: 'ignored',
    })
    expect(publish).not.toHaveBeenCalled()
    expect(record.mock.calls[0]![0]).toMatchObject({
      outcome: 'ignored_property_not_found',
      resolvedPropertyId: null,
      event: null,
    })
  })

  it('does not route a stale account/location binding to another property', async () => {
    const { useCase, publish, record } = setup({
      property: { ...PROPERTY, gbpAccountId: 'different-account' },
    })

    await expect(useCase(INPUT)).resolves.toMatchObject({ handoff: 'ignored' })
    expect(publish).not.toHaveBeenCalled()
    expect(record.mock.calls[0]![0]).toMatchObject({
      outcome: 'ignored_binding_mismatch',
      event: null,
    })
  })

  it('rejects a non-canonical cross-location review resource before writing a receipt', async () => {
    const { useCase, record } = setup()
    await expect(
      useCase({
        ...INPUT,
        reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE.replace(
          `/locations/${LOCATION_ID}/`,
          '/locations/different-location/',
        ),
      }),
    ).rejects.toThrow('resource mismatch')
    expect(record).not.toHaveBeenCalled()
  })
})
