// "Check on Google" (checkReviewOnGoogleFn), called as signed-in members over
// PostgreSQL with the real tenant resolution, execution policy and Inbox API.
// The Property has no Google connection, so a Google review cannot be read and
// the verdict is `not_checkable`; reading a reply from Google is covered by the
// use case's own tests.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { checkReviewOnGoogleFn } from './inbox-google-check'

const harness = setupServerFunctionHarness({ cleanupTables: [...REVIEW_SEED_TABLES] })

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  const review = await harness.seedReview(property)
  await harness.seedInboxItem({ review })
  return { organization, admin, manager, property, review }
}

describe('checkReviewOnGoogleFn', () => {
  it('is a POST', () => {
    expect(checkReviewOnGoogleFn).toHaveProperty('method', 'POST')
  })

  it('answers a verdict to an AccountAdmin', async () => {
    const { admin, review } = await hotel()

    const verdict = await harness.callAs(admin, () =>
      checkReviewOnGoogleFn({ data: { reviewId: review.id } }),
    )

    expect(verdict).toEqual({ outcome: 'not_checkable' })
  })

  it('answers a verdict to a PropertyManager the Property was granted to', async () => {
    const { manager, review } = await hotel()

    const verdict = await harness.callAs(manager, () =>
      checkReviewOnGoogleFn({ data: { reviewId: review.id } }),
    )

    expect(verdict).toEqual({ outcome: 'not_checkable' })
  })

  it('refuses a PropertyManager without a grant on the Property', async () => {
    const { organization, review } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        checkReviewOnGoogleFn({ data: { reviewId: review.id } }),
      ),
    ).rejects.toMatchObject({ _tag: 'InboxError', status: 403 })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, review } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () =>
        checkReviewOnGoogleFn({ data: { reviewId: review.id } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })

  it('surfaces an Inbox refusal for a review that has no Inbox item', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        checkReviewOnGoogleFn({ data: { reviewId: crypto.randomUUID() } }),
      ),
    ).rejects.toMatchObject({ _tag: 'InboxError', code: 'not_found', status: 404 })
  })

  it('does not find the review for an AccountAdmin of another Organization', async () => {
    const { review } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        checkReviewOnGoogleFn({ data: { reviewId: review.id } }),
      ),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 })
  })

  it('refuses a caller with no session', async () => {
    const { review } = await hotel()

    await expect(
      harness.callAs(null, () =>
        checkReviewOnGoogleFn({ data: { reviewId: review.id } }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('refuses a review id that is not a UUID', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, (): Promise<unknown> =>
        checkReviewOnGoogleFn({ data: { reviewId: 'review-1' } }),
      ),
    ).rejects.toThrow(/reviewId/)
  })
})
