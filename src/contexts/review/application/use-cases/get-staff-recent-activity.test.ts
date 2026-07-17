// getStaffRecentActivity — BQC-1.4: the staff recent-activity widget is a
// serving read. It must query the eligible-reviews method (never the raw
// findByPropertyId) with the injected clock, and map only what it returns.

import { describe, it, expect, vi } from 'vitest'
import { getStaffRecentActivity } from './get-staff-recent-activity'
import type { ReviewRepository } from '../ports/review.repository'
import type { Review } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, propertyId } from '#/shared/domain/ids'

const ORG = organizationId('org-1')
const PROP = propertyId('1a000000-0000-0000-0000-000000000001')
const NOW = new Date('2026-07-17T12:00:00Z')

const CTX = {
  userId: 'user-1',
  organizationId: ORG,
  role: 'Staff',
} as unknown as AuthContext

function makeReview(overrides: Record<string, unknown> = {}): Review {
  return {
    id: 'rev-1',
    rating: 4,
    text: 'Lovely breakfast',
    reviewedAt: new Date('2026-07-01T10:00:00Z'),
    ...overrides,
  } as unknown as Review
}

function makeDeps(rows: Review[] = [makeReview()]) {
  const reviewRepo = {
    findRecentEligibleByPropertyId: vi.fn(async () => rows),
    findByPropertyId: vi.fn(async () => {
      throw new Error('serving reads must not use findByPropertyId (BQC-1.4)')
    }),
  }
  const staffPublicApi = {
    getAccessiblePropertyIds: vi.fn(async () => [PROP]),
  }
  const useCase = getStaffRecentActivity({
    reviewRepo: reviewRepo as unknown as ReviewRepository,
    staffPublicApi: staffPublicApi as never,
    clock: () => NOW,
  })
  return { useCase, reviewRepo }
}

describe('getStaffRecentActivity (BQC-1.4)', () => {
  it('reads via findRecentEligibleByPropertyId with the injected clock', async () => {
    const { useCase, reviewRepo } = makeDeps()
    const result = await useCase({ propertyId: PROP, limit: 5 }, CTX)

    expect(reviewRepo.findRecentEligibleByPropertyId).toHaveBeenCalledWith(
      PROP,
      ORG,
      { limit: 5 },
      NOW,
    )
    expect(reviewRepo.findByPropertyId).not.toHaveBeenCalled()
    expect(result).toEqual([
      {
        id: 'rev-1',
        rating: 4,
        snippet: 'Lovely breakfast',
        date: '2026-07-01T10:00:00.000Z',
      },
    ])
  })

  it('returns empty when the property is not accessible', async () => {
    const { useCase, reviewRepo } = makeDeps()
    const result = await useCase(
      { propertyId: propertyId('9c000000-0000-0000-0000-000000000099') },
      CTX,
    )
    expect(result).toEqual([])
    expect(reviewRepo.findRecentEligibleByPropertyId).not.toHaveBeenCalled()
  })
})
