import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_PROVIDER_FIXTURES_V1,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { handleGbpNotification, type PropertyLookup } from './handle-gbp-notification'
import type { GoogleReviewPushReferenceStore } from '../ports/google-review-push-reference.port'
import type { GbpReviewPushReceiptStore } from '../ports/gbp-review-push-receipt.port'

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

const OTHER_ORGANIZATION_ID = 'org-google-push-other'
const OTHER_PROPERTY_ID = '00000000-0000-4000-8000-000000000011'
const OTHER_CONNECTION_ID = '00000000-0000-4000-8000-000000000012'

/** The same location held by a Property of another Organization. */
const OTHER_PROPERTY: PropertyLookup = {
  ...PROPERTY,
  id: OTHER_PROPERTY_ID,
  organizationId: OTHER_ORGANIZATION_ID,
  googleConnectionId: OTHER_CONNECTION_ID,
  sourceEpoch: 2,
}

function setup(
  input: Readonly<{
    /** Every Property that holds the location, in the lookup's order. */
    holders?: readonly PropertyLookup[]
    publish?: GoogleReviewPushReferenceStore['publish']
    receiptStatus?: 'recorded' | 'duplicate'
  }> = {},
) {
  const publish = vi.fn<GoogleReviewPushReferenceStore['publish']>(
    input.publish ?? (async () => ({ ok: true, referenceRef: REFERENCE_REF })),
  )
  const record = vi.fn<GbpReviewPushReceiptStore['record']>(async () => ({
    status: input.receiptStatus ?? 'recorded',
  }))
  const useCase = handleGbpNotification({
    propertyLookup: {
      listByGbpLocationId: async () => input.holders ?? [PROPERTY],
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
      propertyIds: [PROPERTY_ID],
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
    })
    expect(receipt.deliveries).toHaveLength(1)
    expect(receipt.deliveries[0]).toMatchObject({
      resolvedPropertyId: PROPERTY_ID,
      outcome: 'accepted_targeted',
      event: {
        _tag: 'integration.google_review_push.accepted',
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        sourceEpoch: 5,
        referenceRef: REFERENCE_REF,
      },
    })
    expect(JSON.stringify(receipt.deliveries)).not.toContain('accounts/')
  })

  // A location is unique only within an Organization. One row is not "the"
  // Property: the push is for every Property bound to the account it names.
  it('hands the push to the bound Property when another Organization holds the location too', async () => {
    const { useCase, publish, record } = setup({
      holders: [
        { ...OTHER_PROPERTY, googleBindingState: 'disconnected' },
        { ...OTHER_PROPERTY, id: 'other-account', gbpAccountId: 'different-account' },
        PROPERTY,
      ],
    })

    await expect(useCase(INPUT)).resolves.toEqual({
      accepted: true,
      duplicate: false,
      handoff: 'targeted',
      propertyIds: [PROPERTY_ID],
    })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(record.mock.calls[0]![0].deliveries).toMatchObject([
      { resolvedPropertyId: PROPERTY_ID, outcome: 'accepted_targeted' },
    ])
  })

  it('hands one push to every Organization bound to the same account and location', async () => {
    const { useCase, publish, record } = setup({ holders: [OTHER_PROPERTY, PROPERTY] })

    await expect(useCase(INPUT)).resolves.toEqual({
      accepted: true,
      duplicate: false,
      handoff: 'targeted',
      propertyIds: [OTHER_PROPERTY_ID, PROPERTY_ID],
    })

    // Each reference is published under its own tenant's scope.
    expect(publish.mock.calls.map(([call]) => call.scope)).toEqual([
      {
        organizationId: OTHER_ORGANIZATION_ID,
        propertyId: OTHER_PROPERTY_ID,
        connectionId: OTHER_CONNECTION_ID,
        sourceEpoch: 2,
      },
      {
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        sourceEpoch: 5,
      },
    ])
    // One receipt call, so the message is deduplicated once for all of them.
    expect(record).toHaveBeenCalledTimes(1)
    expect(record.mock.calls[0]![0].deliveries).toMatchObject([
      {
        resolvedPropertyId: OTHER_PROPERTY_ID,
        outcome: 'accepted_targeted',
        event: {
          organizationId: OTHER_ORGANIZATION_ID,
          propertyId: OTHER_PROPERTY_ID,
          connectionId: OTHER_CONNECTION_ID,
          sourceEpoch: 2,
        },
      },
      {
        resolvedPropertyId: PROPERTY_ID,
        outcome: 'accepted_targeted',
        event: {
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          connectionId: CONNECTION_ID,
          sourceEpoch: 5,
        },
      },
    ])
  })

  it('records each Property its own outcome when only one reference could be published', async () => {
    const { useCase, record } = setup({
      holders: [OTHER_PROPERTY, PROPERTY],
      publish: async ({ scope }) =>
        scope.propertyId === PROPERTY_ID
          ? { ok: true, referenceRef: REFERENCE_REF }
          : { ok: false, code: 'capacity_exceeded' },
    })

    await expect(useCase(INPUT)).resolves.toMatchObject({
      handoff: 'reconciliation',
      propertyIds: [OTHER_PROPERTY_ID, PROPERTY_ID],
    })
    expect(record.mock.calls[0]![0].deliveries).toMatchObject([
      {
        resolvedPropertyId: OTHER_PROPERTY_ID,
        outcome: 'accepted_reconciliation',
        event: { referenceRef: null },
      },
      {
        resolvedPropertyId: PROPERTY_ID,
        outcome: 'accepted_targeted',
        event: { referenceRef: REFERENCE_REF },
      },
    ])
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
      publish: async () => ({ ok: false, code: 'unavailable' }),
    })

    await expect(useCase(INPUT)).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      handoff: 'reconciliation',
    })
    expect(record.mock.calls[0]![0].deliveries).toMatchObject([
      { outcome: 'accepted_reconciliation', event: { referenceRef: null } },
    ])
  })

  it('durably ignores an unimported location and emits no handoff fact', async () => {
    const { useCase, publish, record } = setup({ holders: [] })

    await expect(useCase(INPUT)).resolves.toEqual({
      accepted: true,
      duplicate: false,
      handoff: 'ignored',
      propertyIds: [],
    })
    expect(publish).not.toHaveBeenCalled()
    expect(record.mock.calls[0]![0].deliveries).toEqual([
      { outcome: 'ignored_property_not_found', resolvedPropertyId: null, event: null },
    ])
  })

  it('does not route a stale account/location binding to another property', async () => {
    const { useCase, publish, record } = setup({
      holders: [{ ...PROPERTY, gbpAccountId: 'different-account' }],
    })

    await expect(useCase(INPUT)).resolves.toMatchObject({
      handoff: 'ignored',
      propertyIds: [],
    })
    expect(publish).not.toHaveBeenCalled()
    expect(record.mock.calls[0]![0].deliveries).toEqual([
      {
        outcome: 'ignored_binding_mismatch',
        resolvedPropertyId: PROPERTY_ID,
        event: null,
      },
    ])
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
