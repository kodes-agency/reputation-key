// Review context — durable reply-publication intent delivery.
//
// The worker consumer is the recovery path when a manager's reply state and
// publication intent commit, but the request process stops before the fast
// BullMQ admission. It must use the committed publication cycle as both the
// stale-intent fence and the deterministic publish-job identity.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
  type ConsumerEvent,
} from '#/shared/outbox/consumer-registry'
import type { Reply } from '../domain/types'
import {
  handleGoogleAccountDisconnected,
  handleReplyPublicationRequested,
  ON_GOOGLE_ACCOUNT_DISCONNECTED_CONSUMER,
  ON_REPLY_PUBLICATION_REQUESTED_CONSUMER,
  registerReplyPublicationConsumers,
  type ReviewOutboxLogger,
} from './outbox-consumers'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const NOW = new Date('2026-08-26T12:00:00.000Z')
const EVENT_ID = '97000000-0000-0000-0000-000000000001'

function reply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: '97000000-0000-0000-0000-000000000002' as never,
    reviewId: '97000000-0000-0000-0000-000000000003' as never,
    organizationId: 'org-publication-recovery' as never,
    text: 'Thank you for your visit.',
    replyLanguageTag: 'en',
    status: 'approved',
    source: 'internal',
    createdBy: 'manager-publication-recovery' as never,
    approvedBy: 'manager-publication-recovery' as never,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: NOW,
    approvedAt: NOW,
    publishedAt: null,
    publicationState: 'authorized',
    publicationCycle: 4,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function event(overrides: Partial<ConsumerEvent> = {}): ConsumerEvent {
  return {
    eventId: EVENT_ID,
    eventType: 'review.reply.publication_requested',
    eventVersion: 2,
    payload: {
      replyId: '97000000-0000-0000-0000-000000000002',
      reviewId: '97000000-0000-0000-0000-000000000003',
      propertyId: '97000000-0000-0000-0000-000000000004',
      organizationId: 'org-publication-recovery',
      userId: 'manager-publication-recovery',
      publicationCycle: 4,
      sourceEpoch: 3,
      materialReviewRevision: 7,
      baseObservationRevision: 11,
      occurredAt: NOW.toISOString(),
    },
    organizationId: 'org-publication-recovery',
    propertyId: '97000000-0000-0000-0000-000000000004',
    sourceContext: 'review',
    sourceAggregateId: '97000000-0000-0000-0000-000000000003',
    occurredAt: NOW.toISOString(),
    recordedAt: NOW.toISOString(),
    correlationId: null,
    causationId: null,
    sourceAggregateVersion: null,
    region: 'unscoped',
    ...overrides,
  }
}

function deps(current: Reply | null = reply()) {
  const logger: ReviewOutboxLogger = { info: vi.fn() }
  return {
    replyRepo: { findById: vi.fn(async () => current) },
    queue: { addPublishJob: vi.fn(async () => {}) },
    receipts: { insertReceipt: vi.fn(async () => {}) },
    logger,
    cancelPublicationsForConnection: vi.fn(async () => ({
      reviewsScanned: 3,
      cancelled: 2,
      batches: 1,
    })),
  }
}

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
  consumerRegistry = createConsumerRegistry()
})

afterEach(() => {
  consumerRegistry = createConsumerRegistry()
  clearEventSchemas()
})

describe('reply publication requested durable consumer', () => {
  it('registers the governed worker consumer under its exact identity', () => {
    const subject = deps()
    registerReplyPublicationConsumers(consumerRegistry, subject as never)

    expect(consumerRegistry.list()).toContainEqual({
      eventType: 'review.reply.publication_requested',
      consumerName: ON_REPLY_PUBLICATION_REQUESTED_CONSUMER,
    })
    expect(consumerRegistry.list()).toContainEqual({
      eventType: 'integration.google_account.disconnected',
      consumerName: ON_GOOGLE_ACCOUNT_DISCONNECTED_CONSUMER,
    })
    expect(subject.logger.info).toHaveBeenCalledWith('Review consumers registered (2 consumers)')
  })

  it('delivers the committed cycle with a deterministic job identity', async () => {
    // @proof REPLY_PUBLICATION_CRASH#1
    const subject = deps()

    await expect(
      handleReplyPublicationRequested(subject as never, event()),
    ).resolves.toEqual({ status: 'applied' })

    expect(subject.queue.addPublishJob).toHaveBeenCalledWith(
      {
        replyId: '97000000-0000-0000-0000-000000000002',
        organizationId: 'org-publication-recovery',
        publicationCycle: 4,
        propertyId: '97000000-0000-0000-0000-000000000004',
        sourceEpoch: 3,
        materialReviewRevision: 7,
        baseObservationRevision: 11,
        initiator: { kind: 'user', id: 'manager-publication-recovery' },
      },
      { idempotencyKey: 'reply-97000000-0000-0000-0000-000000000002-v4' },
    )
    expect(subject.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_REPLY_PUBLICATION_REQUESTED_CONSUMER,
      'applied',
    )
  })

  it('marks a superseded cycle obsolete without admitting it', async () => {
    // @proof REPLY_PUBLICATION_CRASH#2
    const subject = deps(reply({ publicationCycle: 5 }))

    await expect(
      handleReplyPublicationRequested(subject as never, event()),
    ).resolves.toEqual({ status: 'obsolete' })

    expect(subject.queue.addPublishJob).not.toHaveBeenCalled()
    expect(subject.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_REPLY_PUBLICATION_REQUESTED_CONSUMER,
      'obsolete',
    )
  })

  it('settles a legacy intent without provider-truth fences as obsolete', async () => {
    const subject = deps()
    const legacy = event({
      eventVersion: 1,
      payload: {
        replyId: '97000000-0000-0000-0000-000000000002',
        reviewId: '97000000-0000-0000-0000-000000000003',
        propertyId: '97000000-0000-0000-0000-000000000004',
        organizationId: 'org-publication-recovery',
        userId: 'manager-publication-recovery',
        publicationCycle: 4,
        occurredAt: NOW.toISOString(),
      },
    })

    await expect(
      handleReplyPublicationRequested(subject as never, legacy),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(subject.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('writes no receipt when queue admission fails so delivery can retry', async () => {
    const subject = deps()
    subject.queue.addPublishJob.mockRejectedValue(new Error('queue unavailable'))

    await expect(
      handleReplyPublicationRequested(subject as never, event()),
    ).rejects.toThrow('queue unavailable')

    expect(subject.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})

// BQC-3.8: a revoked Google connection cancels every in-flight reply
// publication on the connection's reviews. Durable delivery replaces the
// former in-process bus handler; the use case is idempotent, so redelivery
// after a crash between cancel and receipt converges.
describe('google account disconnected durable consumer', () => {
  const disconnected = (): ConsumerEvent =>
    event({
      eventType: 'integration.google_account.disconnected',
      eventVersion: 1,
      payload: { organizationId: 'org-publication-recovery', connectionId: 'conn-1' },
      propertyId: null,
      sourceContext: 'integration',
      sourceAggregateId: 'conn-1',
    })

  it('runs the publication cancellation for the connection with cause disconnect', async () => {
    const subject = deps()

    await expect(handleGoogleAccountDisconnected(subject as never, disconnected())).resolves.toEqual({
      status: 'applied',
    })

    expect(subject.cancelPublicationsForConnection).toHaveBeenCalledTimes(1)
    expect(subject.cancelPublicationsForConnection).toHaveBeenCalledWith({
      organizationId: 'org-publication-recovery',
      connectionId: 'conn-1',
      cause: 'disconnect',
    })
    expect(subject.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_GOOGLE_ACCOUNT_DISCONNECTED_CONSUMER,
      'applied',
    )
  })

  it('refuses an envelope whose payload organization differs from its attribution', async () => {
    const subject = deps()

    await expect(
      handleGoogleAccountDisconnected(subject as never, {
        ...disconnected(),
        organizationId: 'org-other',
      }),
    ).rejects.toThrow('attribution mismatch')
    expect(subject.cancelPublicationsForConnection).not.toHaveBeenCalled()
  })

  it('propagates a use-case failure without a receipt so the dispatcher retries', async () => {
    const subject = deps()
    subject.cancelPublicationsForConnection.mockRejectedValueOnce(new Error('db down'))

    await expect(handleGoogleAccountDisconnected(subject as never, disconnected())).rejects.toThrow(
      'db down',
    )
    expect(subject.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
