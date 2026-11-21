// The server-function harness's Review, Inbox item and reply seeds, read back
// through the server functions a manager calls.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from './server-function-harness'
import { REVIEW_SEED_TABLES } from './server-function-review-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { getInboxItemDetailFn } from '#/contexts/reputation/server/inbox-item-queries'
import { checkReplyPublicationFn } from '#/contexts/reputation/server/reply'

const harness = setupServerFunctionHarness({
  cleanupTables: ['outbox_events', ...REVIEW_SEED_TABLES],
})

const seededReviews: string[] = []

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const property = await harness.seedProperty(organization)
  return { organization, admin, property }
}

describe('Review seeds', () => {
  it('seeds a Review whose words, rating and reviewer the Inbox serves', async () => {
    const { admin, property } = await hotel()
    const review = await harness.seedReview(property, {
      rating: 2,
      text: 'The shower ran cold.',
      reviewerName: 'Maria',
    })
    const item = await harness.seedInboxItem({ review })
    seededReviews.push(review.id)

    const detail = await harness.callAs(admin, () =>
      getInboxItemDetailFn({ data: { inboxItemId: item.id } }),
    )

    expect(item.sourceId).toBe(review.id)
    expect(detail.item).toMatchObject({
      id: item.id,
      sourceType: 'review',
      sourceId: review.id,
      propertyId: property.id,
      status: 'open',
      commandRevision: item.commandRevision,
    })
    expect(detail).toMatchObject({
      reviewText: 'The shower ran cold.',
      reviewRating: 2,
      reviewContentStatus: 'available',
    })
  })

  it('seeds a Review whose content has expired', async () => {
    const { admin, property } = await hotel()
    const reviewedAt = new Date(Date.now() - 400 * 86_400_000)
    const review = await harness.seedReview(property, {
      reviewedAt,
      contentExpiresAt: new Date(Date.now() - 86_400_000),
    })
    const item = await harness.seedInboxItem({ review })

    const detail = await harness.callAs(admin, () =>
      getInboxItemDetailFn({ data: { inboxItemId: item.id } }),
    )

    expect(detail).toMatchObject({ reviewText: null, reviewContentStatus: 'expired' })
  })

  it('seeds a closed private-feedback item', async () => {
    const { admin, property } = await hotel()
    const item = await harness.seedInboxItem(
      { feedback: property },
      { status: 'closed', commandRevision: 3 },
    )

    const detail = await harness.callAs(admin, () =>
      getInboxItemDetailFn({ data: { inboxItemId: item.id } }),
    )

    expect(detail.item).toMatchObject({
      id: item.id,
      sourceType: 'feedback',
      status: 'closed',
      commandRevision: 3,
    })
    expect(detail.reviewText).toBeNull()
  })

  it('keeps a seeded Inbox item inside its Organization', async () => {
    const { property } = await hotel()
    const review = await harness.seedReview(property)
    const item = await harness.seedInboxItem({ review })
    const other = await harness.seedOrganization()
    const outsider = await harness.seedMember(other, 'AccountAdmin')

    await expect(
      harness.callAs(outsider, () =>
        getInboxItemDetailFn({ data: { inboxItemId: item.id } }),
      ),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('seeds a reply in the publication state a test names', async () => {
    const { admin, property } = await hotel()
    const review = await harness.seedReview(property)
    const reply = await harness.seedReply(review, {
      status: 'publish_failed',
      publicationState: 'terminal',
      publicationLastErrorClass: 'ambiguous',
      publicationAttempts: 1,
      authorUserId: admin.userId,
      text: 'Sorry about the shower.',
    })
    seededReviews.push(review.id)

    const { rows } = await harness.pool().query(
      `SELECT status, source, authorship, publication_state, publication_cycle,
              publication_attempts, created_by, approved_by, text
         FROM replies WHERE id = $1`,
      [reply.id],
    )
    expect(rows[0]).toEqual({
      status: 'publish_failed',
      source: 'internal',
      authorship: 'human',
      publication_state: 'terminal',
      publication_cycle: '1',
      publication_attempts: 1,
      created_by: admin.userId,
      approved_by: admin.userId,
      text: 'Sorry about the shower.',
    })
    // Without a Google connection there is no Google review to read.
    await expect(
      harness.callAs(admin, () =>
        checkReplyPublicationFn({ data: { reviewId: review.id } }),
      ),
    ).resolves.toMatchObject({
      reply: { id: reply.id, status: 'publish_failed' },
      outcome: 'review_missing_on_google',
    })
  })

  it('cleans up what the previous tests seeded', async () => {
    expect(seededReviews).toHaveLength(2)
    const { rows } = await harness.pool().query(
      `SELECT (SELECT count(*)::int FROM reviews WHERE id = ANY($1::uuid[])) AS reviews,
              (SELECT count(*)::int FROM replies WHERE review_id = ANY($1::uuid[])) AS replies,
              (SELECT count(*)::int FROM inbox_items WHERE source_id = ANY($1::uuid[])) AS items`,
      [seededReviews],
    )
    expect(rows[0]).toEqual({ reviews: 0, replies: 0, items: 0 })
  })
})
