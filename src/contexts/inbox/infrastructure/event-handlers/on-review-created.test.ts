// Inbox context — on-review-created event handler tests
// BQC-1.2: metadata only — no review lookup, no raw content copied.

import { describe, it, expect, vi } from 'vitest'
import { onReviewCreated } from './on-review-created'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))
import type { CreateInboxItem } from '../../application/use-cases/create-inbox-item'
import type { ReviewCreated } from '#/contexts/review/application/public-api'
import { organizationId, reviewId, propertyId } from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const REVIEW_ID = reviewId('rev-1')
const PROP_ID = propertyId('prop-1')
const NOW = new Date('2025-06-01T12:00:00Z')

const mockEvent: ReviewCreated = {
  _tag: 'review.created',
  eventId: 'test-event-id',
  correlationId: null,
  reviewId: REVIEW_ID,
  propertyId: PROP_ID,
  organizationId: ORG_ID,
  platform: 'google',
  externalId: 'ext-1',
  occurredAt: NOW,
}

describe('onReviewCreated', () => {
  it('creates inbox item with event metadata only (BQC-1.2)', async () => {
    const createInboxItem = vi.fn(async () => ({}))

    await onReviewCreated({
      createInboxItem: createInboxItem as unknown as CreateInboxItem,
    })(mockEvent)

    expect(createInboxItem).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review',
      sourceId: REVIEW_ID,
      sourceDate: NOW,
      platform: 'google',
    })
  })

  it('silently handles already_exists error', async () => {
    const alreadyExistsErr = {
      _tag: 'InboxError',
      eventId: 'test-event-id',
      correlationId: null,
      code: 'already_exists' as const,
      message: 'duplicate',
    }
    const createInboxItem = vi.fn(async () => {
      throw alreadyExistsErr
    })

    await expect(
      onReviewCreated({
        createInboxItem: createInboxItem as unknown as CreateInboxItem,
      })(mockEvent),
    ).resolves.toBeUndefined()
  })

  it('logs and swallows other errors', async () => {
    const createInboxItem = vi.fn(async () => {
      throw new Error('DB down')
    })

    await expect(
      onReviewCreated({
        createInboxItem: createInboxItem as unknown as CreateInboxItem,
      })(mockEvent),
    ).resolves.toBeUndefined()
  })
})
