import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { ReviewGoogleReviewCheck } from '#/contexts/review/application/public-api'
import { createGoogleReviewCheckAdapter } from './google-review-check.adapter'

const request = {
  organizationId: organizationId('org-google-review-check-adapter'),
  propertyId: propertyId('7b000000-0000-4000-8000-000000000001'),
  reviewId: reviewId('7b000000-0000-4000-8000-000000000002'),
}

describe('createGoogleReviewCheckAdapter', () => {
  it('hands the request to Review and returns its answer untouched', async () => {
    const source = vi.fn<ReviewGoogleReviewCheck>(async () => ({
      status: 'unavailable',
      retry: 'later',
    }))

    await expect(createGoogleReviewCheckAdapter(source).check(request)).resolves.toEqual({
      status: 'unavailable',
      retry: 'later',
    })
    expect(source).toHaveBeenCalledWith(request)
  })

  it('touches the source only when asked, so a context built without one still builds', () => {
    expect(() =>
      createGoogleReviewCheckAdapter(undefined as unknown as ReviewGoogleReviewCheck),
    ).not.toThrow()
  })
})
