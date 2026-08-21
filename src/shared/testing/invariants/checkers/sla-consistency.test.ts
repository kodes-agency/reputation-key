// sla-consistency — pins the past-SLA warning and the 500-review truncation
// violation. The cap previously reported nothing, so an org past 500 reviews
// got an SLA verdict computed from a prefix.

import { describe, it, expect } from 'vitest'
import { slaConsistency } from './sla-consistency'
import type { Review, Reply } from '#/contexts/review/domain/types'
import type { InvariantContext } from '../types'

const CTX: InvariantContext = { organizationId: 'org-test-0001', slaHours: 48 }
const NOW = new Date('2026-06-01T00:00:00Z')
const MS_PER_HOUR = 3_600_000

const review = (n: number, hoursAgo: number): Review =>
  ({
    id: `review-${n}`,
    propertyId: 'prop-1',
    reviewedAt: new Date(NOW.getTime() - hoursAgo * MS_PER_HOUR),
  }) as unknown as Review

const reviews = (count: number, hoursAgo: number): ReadonlyArray<Review> =>
  Array.from({ length: count }, (_, i) => review(i, hoursAgo))

const deps = (all: ReadonlyArray<Review>, published = false) => ({
  reviewRepo: { findByOrganizationId: async () => all },
  replyRepo: {
    findByReviewId: async () =>
      published
        ? ([{ status: 'published' }] as unknown as ReadonlyArray<Reply>)
        : ([] as ReadonlyArray<Reply>),
  },
  clock: () => NOW,
})

describe('slaConsistency', () => {
  it('passes for a review still inside the SLA window', async () => {
    const violations = await slaConsistency(deps(reviews(3, 1)) as never).check(CTX)
    expect(violations).toEqual([])
  })

  it('warns for a past-SLA review with no published reply', async () => {
    const violations = await slaConsistency(deps(reviews(1, 72)) as never).check(CTX)

    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('warning')
    expect(violations[0].message).toContain('no published reply')
    expect(violations[0].evidence?.hoursPastSla).toBe(24)
  })

  it('passes for a past-SLA review that does have a published reply', async () => {
    const violations = await slaConsistency(deps(reviews(1, 72), true) as never).check(
      CTX,
    )
    expect(violations).toEqual([])
  })

  it('does not report truncation at exactly the cap', async () => {
    const violations = await slaConsistency(deps(reviews(500, 1)) as never).check(CTX)
    expect(violations).toEqual([])
  })

  it('reports truncation past the cap', async () => {
    const violations = await slaConsistency(deps(reviews(501, 1)) as never).check(CTX)

    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('warning')
    expect(violations[0].message).toContain('truncated')
    expect(violations[0].evidence).toEqual({ reviewsChecked: 500, reviewsTotal: 501 })
  })
})
