// Inbox context — on-feedback-submitted event handler tests
// BQC-1.2: metadata only — guest rating/comment resolve live at read time.

import { describe, it, expect, vi } from 'vitest'
import { onFeedbackSubmitted } from './on-feedback-submitted'
import type { CreateInboxItem } from '../../application/use-cases/create-inbox-item'
import type { GuestFeedbackSubmitted } from '#/contexts/guest/application/public-api'
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

const mockEvent: GuestFeedbackSubmitted = {
  _tag: 'guest.feedback.submitted',
  eventId: 'test-event-id',
  correlationId: null,
  feedbackId: FEEDBACK_ID,
  organizationId: ORG_ID,
  portalId: PORTAL_ID,
  propertyId: PROP_ID,
  ratingId: RATING_ID,
  occurredAt: NOW,
}

describe('onFeedbackSubmitted', () => {
  it('creates inbox item with event metadata only (BQC-1.2)', async () => {
    const createInboxItem = vi.fn(async () => ({})) as unknown as CreateInboxItem
    const deps = { createInboxItem }

    await onFeedbackSubmitted(deps)(mockEvent)

    expect(createInboxItem).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'feedback',
      sourceId: FEEDBACK_ID,
      sourceDate: NOW,
      platform: null,
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
    }) as unknown as CreateInboxItem
    const deps = { createInboxItem }

    await expect(onFeedbackSubmitted(deps)(mockEvent)).resolves.toBeUndefined()
  })

  it('does not throw on generic repo error', async () => {
    const createInboxItem = vi.fn(async () => {
      throw new Error('DB down')
    }) as unknown as CreateInboxItem
    const deps = { createInboxItem }

    await expect(onFeedbackSubmitted(deps)(mockEvent)).resolves.toBeUndefined()
  })
})
