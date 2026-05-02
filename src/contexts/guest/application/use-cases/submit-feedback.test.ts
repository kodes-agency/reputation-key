import { submitFeedback } from './submit-feedback'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  feedbackId,
  organizationId,
  portalId,
  propertyId,
  ratingId,
} from '#/shared/domain/ids'
import { isGuestError } from '#/contexts/guest/domain/errors'
import type { Feedback } from '../../domain/types'
import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'

function createInMemoryGuestRepo() {
  const feedback: Feedback[] = []
  const repo: GuestInteractionRepository = {
    recordScan: async () => {},
    insertRating: async () => {},
    insertFeedback: async (fb: Feedback) => {
      feedback.push(fb)
    },
    hasRated: async () => false,
  }
  return { ...repo, feedback }
}

describe('submitFeedback', () => {
  it('submits feedback and emits event', async () => {
    const repo = createInMemoryGuestRepo()
    const bus = createCapturingEventBus()
    const useCase = submitFeedback({
      guestRepo: repo,
      events: bus,
      idGen: () => feedbackId('fb-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    const result = await useCase({
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      sessionId: 'session-abc',
      comment: 'Great service!',
      source: 'qr',
      ipHash: 'hash123',
    })

    expect(result.comment).toBe('Great service!')
    expect(repo.feedback.length).toBe(1)
    expect(bus.capturedEvents).toHaveLength(1)
    expect(bus.capturedEvents[0]._tag).toBe('feedback.submitted')
  })

  it('rejects empty feedback', async () => {
    const repo = createInMemoryGuestRepo()
    const bus = createCapturingEventBus()
    const useCase = submitFeedback({
      guestRepo: repo,
      events: bus,
      idGen: () => feedbackId('fb-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    await expect(
      useCase({
        organizationId: organizationId('org-1'),
        portalId: portalId('portal-1'),
        propertyId: propertyId('prop-1'),
        sessionId: 'session-abc',
        comment: '',
        source: 'qr',
        ipHash: 'hash123',
      }),
    ).rejects.toSatisfy((e: unknown) => {
      return isGuestError(e) && e.code === 'feedback_empty'
    })
  })

  it('accepts optional ratingId', async () => {
    const repo = createInMemoryGuestRepo()
    const bus = createCapturingEventBus()
    const useCase = submitFeedback({
      guestRepo: repo,
      events: bus,
      idGen: () => feedbackId('fb-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    const result = await useCase({
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      sessionId: 'session-abc',
      comment: 'Linked feedback',
      source: 'qr',
      ipHash: 'hash123',
      ratingId: ratingId('rating-1'),
    })

    expect(result.ratingId).toBe(ratingId('rating-1'))
  })
})
