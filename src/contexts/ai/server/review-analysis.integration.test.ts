// Review Analysis server functions, called as signed-in members over
// PostgreSQL with the real tenant resolution and execution policy.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { describe, expect, it, vi } from 'vitest'
import {
  setupServerFunctionHarness,
  type TestProperty,
} from '#/shared/testing/server-function-harness'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'
import { mentionOf, useAiSeeds } from './ai-seed.test-fixtures'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import {
  getReviewAnalysisProgressFn,
  requestReviewAnalysisNowFn,
} from './review-analysis'

const harness = setupServerFunctionHarness({
  cleanupTables: ['ai_review_analysis_backlog', ...REVIEW_SEED_TABLES],
})
const seedAi = useAiSeeds(GOOGLE_LOCATION_PRIMARY_RESOURCE)

const REVIEWED_AT = new Date('2026-10-12T16:00:00Z')

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  return { organization, admin, manager, property }
}

async function queueBacklog(property: TestProperty, reviewId: string) {
  await harness.pool().query(
    `INSERT INTO ai_review_analysis_backlog
       (event_envelope_id, organization_id, property_id, review_id, source_epoch,
        source_revision, analysis_sequence, origin, next_attempt_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 0, 1, 1, 'backfill', now())`,
    [property.organizationId, property.id, reviewId],
  )
}

const analysisJobs = () =>
  harness
    .fakes()
    .queues.default.enqueuedJobs.filter(
      (job) => job.name === 'ai-review-analysis-on-demand',
    )

describe('requestReviewAnalysisNowFn', () => {
  it('answers disabled while AI is not enabled for the Property', async () => {
    const { admin, property } = await hotel()
    const review = await harness.seedReview(property)

    const result = await harness.callAs(admin, () =>
      requestReviewAnalysisNowFn({ data: { reviewId: review.id } }),
    )

    expect(result).toEqual({ status: 'disabled' })
    expect(analysisJobs()).toEqual([])
  })

  it('answers not_pending and queues nothing when the review is not in the backlog', async () => {
    const { admin, property } = await hotel()
    await (await seedAi(property)).setUp()
    const review = await harness.seedReview(property)

    const result = await harness.callAs(admin, () =>
      requestReviewAnalysisNowFn({ data: { reviewId: review.id } }),
    )

    expect(result).toEqual({ status: 'not_pending' })
    expect(analysisJobs()).toEqual([])
  })

  it('queues one on-demand analysis of the review when it waits in the backlog', async () => {
    const { admin, property } = await hotel()
    await (await seedAi(property)).setUp()
    const review = await harness.seedReview(property)
    await queueBacklog(property, review.id)

    const result = await harness.callAs(admin, () =>
      requestReviewAnalysisNowFn({ data: { reviewId: review.id } }),
    )

    expect(result).toEqual({ status: 'queued' })
    expect(analysisJobs()).toHaveLength(1)
    expect(analysisJobs()[0]?.data).toEqual({
      organizationId: property.organizationId,
      propertyId: property.id,
      reviewId: review.id,
    })
  })

  it('lets a PropertyManager the Property was granted to hurry a review', async () => {
    const { manager, property } = await hotel()
    await (await seedAi(property)).setUp()
    const review = await harness.seedReview(property)
    await queueBacklog(property, review.id)

    const result = await harness.callAs(manager, () =>
      requestReviewAnalysisNowFn({ data: { reviewId: review.id } }),
    )

    expect(result).toEqual({ status: 'queued' })
  })

  it('refuses a PropertyManager the Property was not granted to, and queues nothing', async () => {
    const { organization, property } = await hotel()
    await (await seedAi(property)).setUp()
    const review = await harness.seedReview(property)
    await queueBacklog(property, review.id)
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        requestReviewAnalysisNowFn({ data: { reviewId: review.id } }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
    expect(analysisJobs()).toEqual([])
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, property } = await hotel()
    const review = await harness.seedReview(property)
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () =>
        requestReviewAnalysisNowFn({ data: { reviewId: review.id } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })

  it('refuses a caller with no session', async () => {
    const { property } = await hotel()
    const review = await harness.seedReview(property)

    await expect(
      harness.callAs(null, () =>
        requestReviewAnalysisNowFn({ data: { reviewId: review.id } }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('does not find a review that does not exist', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        requestReviewAnalysisNowFn({
          data: { reviewId: '00000000-0000-4000-8000-000000000999' },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
      message: 'Review not found',
    })
    expect(analysisJobs()).toEqual([])
  })

  it('does not find a review of another Organization, and queues nothing', async () => {
    const { property } = await hotel()
    await (await seedAi(property)).setUp()
    const review = await harness.seedReview(property)
    await queueBacklog(property, review.id)
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        requestReviewAnalysisNowFn({ data: { reviewId: review.id } }),
      ),
    ).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
      message: 'Review not found',
    })
    expect(analysisJobs()).toEqual([])
  })

  it('refuses a Property named in the payload: the stored review names it', async () => {
    const { admin, property } = await hotel()
    const review = await harness.seedReview(property)

    await expect(
      harness.callAs(admin, () =>
        requestReviewAnalysisNowFn({
          data: { reviewId: review.id, propertyId: property.id },
        } as never),
      ),
    ).rejects.toThrow(/unrecognized_keys|Unrecognized key/)
  })

  it.each([
    ['not a UUID', { reviewId: 'review-1' }],
    ['missing', {}],
  ])(
    'refuses a review id that is %s, with the path of the field',
    async (_name, data) => {
      const { admin } = await hotel()

      await expect(
        harness.callAs(admin, () => requestReviewAnalysisNowFn({ data } as never)),
      ).rejects.toThrow(/reviewId/)
      expect(analysisJobs()).toEqual([])
    },
  )
})

describe('getReviewAnalysisProgressFn', () => {
  it('answers disabled while AI is not enabled for the Property', async () => {
    const { admin, property } = await hotel()

    const progress = await harness.callAs(admin, () =>
      getReviewAnalysisProgressFn({ data: { propertyId: property.id } }),
    )

    expect(progress).toEqual({ status: 'disabled' })
  })

  it('counts the analysed reviews and the ones still waiting in the backlog', async () => {
    const { admin, property } = await hotel()
    const seed = await seedAi(property)
    await seed.setUp()
    const concern = mentionOf({
      topic: 'facilities_equipment',
      polarity: 'negative',
      thing: 'shower',
      issue: 'cold',
    })
    await seed.addReview({
      index: 1,
      rating: 2,
      reviewedAt: REVIEWED_AT,
      mentions: [concern],
    })
    await seed.addReview({ index: 2, rating: 4, reviewedAt: REVIEWED_AT })
    await seed.seal()
    const waiting = await harness.seedReview(property)
    await queueBacklog(property, waiting.id)

    const progress = await harness.callAs(admin, () =>
      getReviewAnalysisProgressFn({ data: { propertyId: property.id } }),
    )

    expect(progress).toMatchObject({
      status: 'analysing',
      queued: 1,
      inProgress: 0,
      analysed: 2,
    })
  })

  it('answers disabled for an AccountAdmin naming another Organization’s Property', async () => {
    const { property } = await hotel()
    await (await seedAi(property)).setUp()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    const progress = await harness.callAs(otherAdmin, () =>
      getReviewAnalysisProgressFn({ data: { propertyId: property.id } }),
    )

    expect(progress).toEqual({ status: 'disabled' })
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { organization, property } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        getReviewAnalysisProgressFn({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, property } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () =>
        getReviewAnalysisProgressFn({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })

  it('refuses a caller with no session', async () => {
    const { property } = await hotel()

    await expect(
      harness.callAs(null, () =>
        getReviewAnalysisProgressFn({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it.each([
    ['not a UUID', { propertyId: 'property-1' }],
    ['missing', {}],
  ])('refuses a Property id that is %s', async (_name, data) => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () => getReviewAnalysisProgressFn({ data } as never)),
    ).rejects.toThrow(/propertyId/)
  })

  it('refuses an Organization id in the payload', async () => {
    const { admin, organization, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        getReviewAnalysisProgressFn({
          data: { propertyId: property.id, organizationId: organization.id },
        } as never),
      ),
    ).rejects.toThrow(/unrecognized_keys|Unrecognized key/)
  })
})
