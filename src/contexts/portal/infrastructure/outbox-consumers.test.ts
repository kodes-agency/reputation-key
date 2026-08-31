import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import {
  handlePortalHeroImageProcessingRequested,
  PORTAL_HERO_IMAGE_PROCESSING_CONSUMER,
  registerPortalConsumers,
} from './outbox-consumers'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const EVENT_ID = '70000000-0000-4000-8000-000000000009'
const ORGANIZATION_ID = 'org-portal-upload'
const PROPERTY_ID = '70000000-0000-4000-8000-000000000010'
const PORTAL_ID = '70000000-0000-4000-8000-000000000011'
const UPLOAD_ID = '70000000-0000-4000-8000-000000000012'
const ETAG = '"d41d8cd98f00b204e9800998ecf8427e"'

const event = (overrides: Partial<ConsumerEvent> = {}): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'portal.hero_image.processing_requested',
  eventVersion: 1,
  payload: {
    uploadId: UPLOAD_ID,
    portalId: PORTAL_ID,
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    sourceETag: ETAG,
    occurredAt: '2026-08-26T12:00:00.000Z',
  },
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  sourceContext: 'portal',
  sourceAggregateId: UPLOAD_ID,
  ...overrides,
})

const makeDeps = (outcome: 'processed' | 'stale' = 'processed') => ({
  processIssuedPortalImage: vi.fn(async () => outcome),
  receipts: { insertReceipt: vi.fn(async () => {}) },
})

describe('Portal hero image durable consumer', () => {
  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
  })
  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
  })

  it('registers exactly once under the Portal upload capability module', () => {
    registerPortalConsumers(consumerRegistry, makeDeps())
    expect(consumerRegistry.list()).toContainEqual({
      eventType: 'portal.hero_image.processing_requested',
      consumerName: PORTAL_HERO_IMAGE_PROCESSING_CONSUMER,
    })
  })

  it('passes the persisted ETag fence to processing and records completion', async () => {
    const deps = makeDeps()
    await expect(
      handlePortalHeroImageProcessingRequested(deps, event()),
    ).resolves.toEqual({ status: 'applied' })
    expect(deps.processIssuedPortalImage).toHaveBeenCalledWith({
      uploadId: UPLOAD_ID,
      portalId: PORTAL_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceETag: ETAG,
    })
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      PORTAL_HERO_IMAGE_PROCESSING_CONSUMER,
      'applied',
    )
  })

  it('records an obsolete receipt for a stale issuance', async () => {
    const deps = makeDeps('stale')
    await expect(
      handlePortalHeroImageProcessingRequested(deps, event()),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      PORTAL_HERO_IMAGE_PROCESSING_CONSUMER,
      'obsolete',
    )
  })

  it('fails closed before processing when envelope attribution differs', async () => {
    const deps = makeDeps()
    await expect(
      handlePortalHeroImageProcessingRequested(
        deps,
        event({ propertyId: '70000000-0000-4000-8000-000000000099' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.processIssuedPortalImage).not.toHaveBeenCalled()
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
