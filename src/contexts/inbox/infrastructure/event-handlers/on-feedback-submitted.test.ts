// Inbox context — on-feedback-submitted event handler tests

import { describe, it, expect, vi } from 'vitest'
import { onFeedbackSubmitted } from './on-feedback-submitted'
import type { CreateInboxItemUseCase } from '../../application/use-cases/create-inbox-item'
import type { FeedbackSubmitted } from '#/contexts/guest/application/public-api'
import {
  organizationId,
  propertyId,
  feedbackId,
  portalId,
  ratingId,
} from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const FEEDBACK_ID = feedbackId('fb-1')
const PROP_ID = propertyId('prop-1')
const PORTAL_ID = portalId('portal-1')
const RATING_ID = ratingId('rating-1')
const NOW = new Date('2025-06-01T12:00:00Z')

const mockEvent: FeedbackSubmitted = {
  _tag: 'feedback.submitted',
  feedbackId: FEEDBACK_ID,
  organizationId: ORG_ID,
  portalId: PORTAL_ID,
  propertyId: PROP_ID,
  ratingId: RATING_ID,
  occurredAt: NOW,
}

describe('onFeedbackSubmitted', () => {
  it('creates inbox item for the feedback', async () => {
    const createInboxItem = vi.fn(async () => ({}))
    const deps = { createInboxItem } as unknown as {
      createInboxItem: CreateInboxItemUseCase
    }

    await onFeedbackSubmitted(deps)(mockEvent)

    expect(createInboxItem).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'feedback',
      sourceId: FEEDBACK_ID,
      rating: null,
      sourceDate: NOW,
      platform: null,
      snippet: null,
    })
  })

  it('silently handles already_exists error', async () => {
    const alreadyExistsErr = {
      _tag: 'InboxError',
      code: 'already_exists' as const,
      message: 'duplicate',
    }
    const createInboxItem = vi.fn(async () => {
      throw alreadyExistsErr
    })
    const deps = { createInboxItem } as unknown as {
      createInboxItem: CreateInboxItemUseCase
    }

    await expect(onFeedbackSubmitted(deps)(mockEvent)).resolves.toBeUndefined()
  })

  it('does not throw on generic repo error', async () => {
    const createInboxItem = vi.fn(async () => {
      throw new Error('DB down')
    })
    const deps = { createInboxItem } as unknown as {
      createInboxItem: CreateInboxItemUseCase
    }

    await expect(onFeedbackSubmitted(deps)(mockEvent)).resolves.toBeUndefined()
  })
})
