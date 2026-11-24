import { describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  handlePropertyBindingAuthorizationInvalidation,
  PROVIDER_AUTHORIZATION_INVALIDATION_CONSUMER,
} from './google-import-outbox-consumers.server'
import {
  GBP_REVIEW_PUSH_DISPATCH_CONSUMER,
  handleGoogleReviewPushAccepted,
} from '../review-sync/google-review-push-outbox-consumers.server'

const EVENT: ConsumerEvent = {
  eventId: '00000000-0000-4000-8000-000000000010',
  eventType: 'property.google_binding.changed',
  eventVersion: 1,
  organizationId: 'org-1',
  propertyId: '00000000-0000-4000-8000-000000000001',
  sourceContext: 'property',
  sourceAggregateId: '00000000-0000-4000-8000-000000000001',
  payload: {
    organizationId: 'org-1',
    propertyId: '00000000-0000-4000-8000-000000000001',
    connectionId: '00000000-0000-4000-8000-000000000002',
    sourceEpoch: 3,
    change: 'relinked',
  },
}

const PROPERTY_ID = '00000000-0000-4000-8000-000000000001'
const CONNECTION_ID = '00000000-0000-4000-8000-000000000002'

function references(result = true) {
  return {
    invalidateProperty: vi.fn(async () => result),
    invalidateConnection: vi.fn(async () => result),
  }
}

describe('property binding provider-authorization invalidation consumer', () => {
  it('invalidates the property and connection references before recording its durable receipt', async () => {
    const refs = references()
    const insertReceipt = vi.fn(async () => undefined)

    await expect(
      handlePropertyBindingAuthorizationInvalidation(
        { references: refs, receipts: { insertReceipt } },
        { ...EVENT, payload: { ...(EVENT.payload as object), change: 'disconnected' } },
      ),
    ).resolves.toEqual({ status: 'applied' })

    expect(refs.invalidateProperty).toHaveBeenCalledWith({
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
    })
    expect(refs.invalidateConnection).toHaveBeenCalledWith({
      organizationId: 'org-1',
      connectionId: CONNECTION_ID,
    })
    expect(insertReceipt).toHaveBeenCalledWith(
      EVENT.eventId,
      PROVIDER_AUTHORIZATION_INVALIDATION_CONSUMER,
      'applied',
    )
    expect(refs.invalidateConnection.mock.invocationCallOrder[0]).toBeLessThan(
      insertReceipt.mock.invocationCallOrder[0]!,
    )
  })

  it('invalidates only the property references when the binding was relinked', async () => {
    const refs = references()
    const insertReceipt = vi.fn(async () => undefined)

    await expect(
      handlePropertyBindingAuthorizationInvalidation(
        { references: refs, receipts: { insertReceipt } },
        EVENT,
      ),
    ).resolves.toEqual({ status: 'applied' })
    expect(refs.invalidateProperty).toHaveBeenCalledTimes(1)
    expect(refs.invalidateConnection).not.toHaveBeenCalled()
  })

  it('records a newly created binding as obsolete without invalidating live import references', async () => {
    const refs = references()
    const insertReceipt = vi.fn(async () => undefined)

    await expect(
      handlePropertyBindingAuthorizationInvalidation(
        { references: refs, receipts: { insertReceipt } },
        {
          ...EVENT,
          payload: { ...(EVENT.payload as Record<string, unknown>), change: 'created' },
        },
      ),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(refs.invalidateProperty).not.toHaveBeenCalled()
    expect(refs.invalidateConnection).not.toHaveBeenCalled()
    expect(insertReceipt).toHaveBeenCalledWith(
      EVENT.eventId,
      PROVIDER_AUTHORIZATION_INVALIDATION_CONSUMER,
      'obsolete',
    )
  })

  it('fails closed without a receipt when a reference invalidation fails', async () => {
    const insertReceipt = vi.fn(async () => undefined)
    await expect(
      handlePropertyBindingAuthorizationInvalidation(
        { references: references(false), receipts: { insertReceipt } },
        EVENT,
      ),
    ).rejects.toThrow('Provider authorization invalidation failed')
    expect(insertReceipt).not.toHaveBeenCalled()
  })

  it('rejects cross-organization envelope attribution', async () => {
    const refs = references()
    await expect(
      handlePropertyBindingAuthorizationInvalidation(
        { references: refs, receipts: { insertReceipt: vi.fn() } },
        { ...EVENT, organizationId: 'org-other' },
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(refs.invalidateProperty).not.toHaveBeenCalled()
  })
})

const PUSH_EVENT: ConsumerEvent = {
  eventId: '00000000-0000-4000-8000-000000000020',
  eventType: 'integration.google_review_push.accepted',
  eventVersion: 1,
  organizationId: 'org-1',
  propertyId: '00000000-0000-4000-8000-000000000021',
  sourceContext: 'integration',
  sourceAggregateId: '00000000-0000-4000-8000-000000000021',
  payload: {
    organizationId: 'org-1',
    propertyId: '00000000-0000-4000-8000-000000000021',
    connectionId: '00000000-0000-4000-8000-000000000022',
    sourceEpoch: 7,
    referenceRef: 'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    notificationKind: 'UPDATED_REVIEW',
    occurredAt: '2026-08-27T10:00:00.000Z',
  },
}

describe('GBP review push durable dispatch consumer', () => {
  it('enqueues identifier-only targeted work before recording its receipt', async () => {
    const addTargetedFetchJob = vi.fn(async () => undefined)
    const insertReceipt = vi.fn(async () => undefined)

    await expect(
      handleGoogleReviewPushAccepted(
        {
          queue: { addTargetedFetchJob },
          receipts: { insertReceipt },
        },
        PUSH_EVENT,
      ),
    ).resolves.toEqual({ status: 'applied' })

    expect(addTargetedFetchJob).toHaveBeenCalledWith(
      {
        mode: 'targeted',
        organizationId: 'org-1',
        propertyId: '00000000-0000-4000-8000-000000000021',
        connectionId: '00000000-0000-4000-8000-000000000022',
        sourceEpoch: 7,
        referenceRef: 'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        deliveryId: PUSH_EVENT.eventId,
        acceptedAt: '2026-08-27T10:00:00.000Z',
        notificationKind: 'UPDATED_REVIEW',
        initiator: { kind: 'system', id: 'webhook:gbp' },
        correlationId: `gbp-push-${PUSH_EVENT.eventId}`,
      },
      { jobId: `gbp-push-${PUSH_EVENT.eventId}` },
    )
    expect(JSON.stringify(addTargetedFetchJob.mock.calls)).not.toContain('accounts/')
    expect(JSON.stringify(addTargetedFetchJob.mock.calls)).not.toContain('/reviews/')
    expect(insertReceipt).toHaveBeenCalledWith(
      PUSH_EVENT.eventId,
      GBP_REVIEW_PUSH_DISPATCH_CONSUMER,
      'applied',
    )
    expect(addTargetedFetchJob.mock.invocationCallOrder[0]).toBeLessThan(
      insertReceipt.mock.invocationCallOrder[0]!,
    )
  })

  it('does not acknowledge the fact when queue admission fails', async () => {
    const insertReceipt = vi.fn(async () => undefined)

    await expect(
      handleGoogleReviewPushAccepted(
        {
          queue: {
            addTargetedFetchJob: vi.fn(async () => {
              throw new Error('queue unavailable')
            }),
          },
          receipts: { insertReceipt },
        },
        PUSH_EVENT,
      ),
    ).rejects.toThrow('queue unavailable')

    expect(insertReceipt).not.toHaveBeenCalled()
  })

  it.each([
    { organizationId: 'org-other' },
    { propertyId: '00000000-0000-4000-8000-000000000099' },
    { sourceAggregateId: '00000000-0000-4000-8000-000000000099' },
  ])('rejects mismatched envelope attribution %#', async (override) => {
    const addTargetedFetchJob = vi.fn()
    const insertReceipt = vi.fn()

    await expect(
      handleGoogleReviewPushAccepted(
        { queue: { addTargetedFetchJob }, receipts: { insertReceipt } },
        { ...PUSH_EVENT, ...override },
      ),
    ).rejects.toThrow('attribution mismatch')

    expect(addTargetedFetchJob).not.toHaveBeenCalled()
    expect(insertReceipt).not.toHaveBeenCalled()
  })
})
