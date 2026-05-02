import { submitRating } from './submit-rating'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { ratingId, organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { isGuestError } from '#/contexts/guest/domain/errors'
import type { Rating } from '../../domain/types'
import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'

function createInMemoryGuestRepo() {
  const ratings: Rating[] = []
  const repo: GuestInteractionRepository = {
    recordScan: async () => {},
    insertRating: async (rating: Rating) => {
      ratings.push(rating)
    },
    insertFeedback: async () => {},
    hasRated: async (_orgId, sessionId, _portalId) =>
      ratings.some((r) => r.sessionId === sessionId),
  }
  return { ...repo, ratings }
}

describe('submitRating', () => {
  it('submits rating and emits event', async () => {
    const repo = createInMemoryGuestRepo()
    const bus = createCapturingEventBus()
    const useCase = submitRating({
      guestRepo: repo,
      events: bus,
      idGen: () => ratingId('rating-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    const result = await useCase({
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      sessionId: 'session-abc',
      value: 5,
      source: 'qr',
      ipHash: 'hash123',
    })

    expect(result.value).toBe(5)
    expect(repo.ratings.length).toBe(1)
    expect(bus.capturedEvents).toHaveLength(1)
    expect(bus.capturedEvents[0]._tag).toBe('rating.submitted')
  })

  it('throws on duplicate rating', async () => {
    const repo = createInMemoryGuestRepo()
    const bus = createCapturingEventBus()
    const useCase = submitRating({
      guestRepo: repo,
      events: bus,
      idGen: () => ratingId('rating-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    const input = {
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      sessionId: 'session-abc',
      value: 4,
      source: 'qr' as const,
      ipHash: 'hash123',
    }

    await useCase(input)

    await expect(useCase(input)).rejects.toSatisfy((e: unknown) => {
      return isGuestError(e) && e.code === 'duplicate_rating'
    })
  })

  it('throws on invalid rating value', async () => {
    const repo = createInMemoryGuestRepo()
    const bus = createCapturingEventBus()
    const useCase = submitRating({
      guestRepo: repo,
      events: bus,
      idGen: () => ratingId('rating-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    await expect(
      useCase({
        organizationId: organizationId('org-1'),
        portalId: portalId('portal-1'),
        propertyId: propertyId('prop-1'),
        sessionId: 'session-abc',
        value: 0,
        source: 'qr',
        ipHash: 'hash123',
      }),
    ).rejects.toSatisfy((e: unknown) => {
      return isGuestError(e) && e.code === 'invalid_rating'
    })
  })
})
