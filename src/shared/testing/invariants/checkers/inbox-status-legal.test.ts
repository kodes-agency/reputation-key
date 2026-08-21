// inbox-status-legal — the checker is ERROR severity, so its 500-review cap is
// the most dangerous truncation in the harness: past the cap it used to report
// a clean pass having examined only a prefix. These tests pin both the original
// stale-inbox violation and the truncation violation that replaced the silence.

import { describe, it, expect } from 'vitest'
import { inboxStatusLegal } from './inbox-status-legal'
import type { Review } from '#/contexts/review/domain/types'
import type { Reply } from '#/contexts/review/domain/types'
import type { InboxItem } from '#/contexts/inbox/domain/types'
import type { InvariantContext } from '../types'

const CTX: InvariantContext = { organizationId: 'org-test-0001' }

const review = (n: number): Review =>
  ({
    id: `review-${n}`,
    propertyId: 'prop-1',
    reviewedAt: new Date('2026-01-01T00:00:00Z'),
  }) as unknown as Review

const reviews = (count: number): ReadonlyArray<Review> =>
  Array.from({ length: count }, (_, i) => review(i))

const publishedReply = () => [{ status: 'published' }] as unknown as ReadonlyArray<Reply>

const openInboxItem = (id: string) => ({ id, status: 'open' }) as unknown as InboxItem

const closedInboxItem = (id: string) => ({ id, status: 'closed' }) as unknown as InboxItem

const deps = (
  all: ReadonlyArray<Review>,
  opts?: { published?: boolean; inbox?: InboxItem | null },
) => ({
  reviewRepo: { findByOrganizationId: async () => all },
  replyRepo: {
    findByReviewId: async () =>
      opts?.published === true ? publishedReply() : ([] as ReadonlyArray<Reply>),
  },
  inboxRepo: { findBySource: async () => opts?.inbox ?? null },
})

describe('inboxStatusLegal', () => {
  it('passes when no review has a published reply', async () => {
    const violations = await inboxStatusLegal(deps(reviews(3)) as never).check(CTX)
    expect(violations).toEqual([])
  })

  it('reports an open inbox item behind a published reply', async () => {
    const violations = await inboxStatusLegal(
      deps(reviews(1), { published: true, inbox: openInboxItem('inbox-1') }) as never,
    ).check(CTX)

    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('error')
    expect(violations[0].message).toContain("inbox item is 'open'")
  })

  it('passes when the inbox item behind a published reply is already closed', async () => {
    const violations = await inboxStatusLegal(
      deps(reviews(1), { published: true, inbox: closedInboxItem('inbox-1') }) as never,
    ).check(CTX)
    expect(violations).toEqual([])
  })

  it('does not report truncation at exactly the cap', async () => {
    const violations = await inboxStatusLegal(deps(reviews(500)) as never).check(CTX)
    expect(violations).toEqual([])
  })

  it('reports truncation past the cap as an ERROR, not silence', async () => {
    const violations = await inboxStatusLegal(deps(reviews(501)) as never).check(CTX)

    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('error')
    expect(violations[0].message).toContain('truncated')
    expect(violations[0].evidence).toEqual({
      reviewsChecked: 500,
      reviewsTotal: 501,
      reviewsUnchecked: 1,
    })
  })

  it('reports truncation alongside the violations it did find', async () => {
    const violations = await inboxStatusLegal(
      deps(reviews(501), { published: true, inbox: openInboxItem('inbox-1') }) as never,
    ).check(CTX)

    // 500 stale-inbox errors + 1 truncation error — the prefix result is
    // reported, but never as a complete verdict.
    expect(violations).toHaveLength(501)
    expect(violations.filter((v) => v.message.includes('truncated'))).toHaveLength(1)
  })
})
