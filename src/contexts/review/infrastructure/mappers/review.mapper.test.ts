// Review context — review mapper tests

import { describe, it, expect } from 'vitest'
import { reviewFromRow, reviewToRow } from './review.mapper'
import type { reviews } from '#/shared/db/schema/review.schema'
import { isReviewError } from '../../domain/errors'

type ReviewRow = typeof reviews.$inferSelect

const now = new Date('2025-06-01T12:00:00Z')
const reviewedAt = new Date('2025-05-27T12:00:00Z')
const expiresAt = new Date('2025-06-26T12:00:00Z')

const sampleRow: ReviewRow = {
  id: 'rev-uuid-001',
  organizationId: 'org-uuid-001',
  propertyId: 'prop-uuid-001',
  platform: 'google',
  externalId: 'google-review-123',
  externalLocationId: 'accounts/111/locations/222',
  googleConnectionId: 'conn-uuid-001',
  reviewerName: 'Jane Doe',
  reviewerProfilePhotoUrl: 'https://example.com/photo.jpg',
  rating: 5,
  text: 'Great place!',
  languageCode: 'en',
  reviewedAt,
  expiresAt,
  sentimentLabel: 'positive',
  sentimentScore: 0.92,
  createdAt: now,
  updatedAt: now,
}

describe('reviewFromRow', () => {
  it('brands IDs correctly', () => {
    const review = reviewFromRow(sampleRow)
    expect(String(review.id)).toBe('rev-uuid-001')
    expect(String(review.organizationId)).toBe('org-uuid-001')
    expect(String(review.propertyId)).toBe('prop-uuid-001')
    expect(String(review.googleConnectionId)).toBe('conn-uuid-001')
  })

  it('maps all fields', () => {
    const review = reviewFromRow(sampleRow)
    expect(review.platform).toBe('google')
    expect(review.externalId).toBe('google-review-123')
    expect(review.externalLocationId).toBe('accounts/111/locations/222')
    expect(review.reviewerName).toBe('Jane Doe')
    expect(review.reviewerProfilePhotoUrl).toBe('https://example.com/photo.jpg')
    expect(review.rating).toBe(5)
    expect(review.text).toBe('Great place!')
    expect(review.languageCode).toBe('en')
    expect(review.reviewedAt).toBe(reviewedAt)
    expect(review.expiresAt).toBe(expiresAt)
    expect(review.sentimentLabel).toBe('positive')
    expect(review.sentimentScore).toBe(0.92)
    expect(review.createdAt).toBe(now)
    expect(review.updatedAt).toBe(now)
  })

  it('handles null googleConnectionId', () => {
    const row = { ...sampleRow, googleConnectionId: null }
    const review = reviewFromRow(row)
    expect(review.googleConnectionId).toBeNull()
  })

  it('handles null optional fields', () => {
    const row: ReviewRow = {
      ...sampleRow,
      reviewerName: null,
      reviewerProfilePhotoUrl: null,
      text: null,
      languageCode: null,
      sentimentLabel: null,
      sentimentScore: null,
    }
    const review = reviewFromRow(row)
    expect(review.reviewerName).toBeNull()
    expect(review.reviewerProfilePhotoUrl).toBeNull()
    expect(review.text).toBeNull()
    expect(review.languageCode).toBeNull()
    expect(review.sentimentLabel).toBeNull()
    expect(review.sentimentScore).toBeNull()
  })

  it('throws a tagged ReviewError (not bare Error) for an invalid platform', () => {
    const row = { ...sampleRow, platform: 'yelp' as unknown as 'google' }
    let thrown: unknown
    try {
      reviewFromRow(row)
    } catch (e) {
      thrown = e
    }
    expect(isReviewError(thrown)).toBe(true)
    if (isReviewError(thrown)) {
      expect(thrown.code).toBe('invalid_row')
    }
  })

  it('throws a tagged ReviewError (not bare Error) for an invalid rating', () => {
    const row = { ...sampleRow, rating: 0 as unknown as number }
    let thrown: unknown
    try {
      reviewFromRow(row)
    } catch (e) {
      thrown = e
    }
    expect(isReviewError(thrown)).toBe(true)
    if (isReviewError(thrown)) {
      expect(thrown.code).toBe('invalid_row')
    }
  })
})

describe('reviewToRow', () => {
  it('round-trips through fromRow → toRow', () => {
    const review = reviewFromRow(sampleRow)
    const row = reviewToRow(review)

    expect(row.id).toBe(sampleRow.id)
    expect(row.organizationId).toBe(sampleRow.organizationId)
    expect(row.propertyId).toBe(sampleRow.propertyId)
    expect(row.platform).toBe(sampleRow.platform)
    expect(row.externalId).toBe(sampleRow.externalId)
    expect(row.externalLocationId).toBe(sampleRow.externalLocationId)
    expect(row.googleConnectionId).toBe(sampleRow.googleConnectionId)
    expect(row.reviewerName).toBe(sampleRow.reviewerName)
    expect(row.reviewerProfilePhotoUrl).toBe(sampleRow.reviewerProfilePhotoUrl)
    expect(row.rating).toBe(sampleRow.rating)
    expect(row.text).toBe(sampleRow.text)
    expect(row.languageCode).toBe(sampleRow.languageCode)
    expect(row.reviewedAt).toBe(sampleRow.reviewedAt)
    expect(row.expiresAt).toBe(sampleRow.expiresAt)
    expect(row.sentimentLabel).toBe(sampleRow.sentimentLabel)
    expect(row.sentimentScore).toBe(sampleRow.sentimentScore)
  })

  it('excludes createdAt and updatedAt', () => {
    const review = reviewFromRow(sampleRow)
    const row = reviewToRow(review)
    expect('createdAt' in row).toBe(false)
    expect('updatedAt' in row).toBe(false)
  })

  it('round-trips null googleConnectionId (fromRow → toRow)', () => {
    const rowWithNull = { ...sampleRow, googleConnectionId: null }
    const review = reviewFromRow(rowWithNull)
    expect(review.googleConnectionId).toBeNull()

    const row = reviewToRow(review)
    expect(row.googleConnectionId).toBeNull()
  })

  it('round-trips non-null googleConnectionId (fromRow → toRow)', () => {
    const review = reviewFromRow(sampleRow)
    expect(review.googleConnectionId).not.toBeNull()
    expect(String(review.googleConnectionId)).toBe('conn-uuid-001')

    const row = reviewToRow(review)
    expect(row.googleConnectionId).toBe('conn-uuid-001')
  })
})
