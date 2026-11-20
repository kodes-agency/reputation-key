// Draft measurement events, recorded as signed-in members over PostgreSQL with
// the real tenant resolution and execution policy. The function answers
// nothing, so each test reads the measurement rows it leaves behind.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, expect, it, vi } from 'vitest'
import {
  setupServerFunctionHarness,
  type TestMember,
} from '#/shared/testing/server-function-harness'
import { seededReviewId, useAiSeeds } from './ai-seed.test-fixtures'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import { recordDraftMeasurementFn } from './draft-measurement'

const harness = setupServerFunctionHarness({
  cleanupTables: ['ai_draft_measurements', 'ai_review_analysis_mention_corrections'],
})
const seedAi = useAiSeeds(GOOGLE_LOCATION_PRIMARY_RESOURCE)

const REVIEWED_AT = new Date('2026-10-12T16:00:00Z')
const BASE_REVISION = 3

type MeasurementRow = Readonly<{
  shown_at: Date | null
  draft_pressed: boolean
  try_again_pressed: boolean
  shorter_pressed: boolean
  tone_pressed: boolean
}>

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  const seed = await seedAi(property)
  await seed.setUp()
  await seed.addReview({ index: 1, rating: 4, reviewedAt: REVIEWED_AT })
  await seed.addReview({ index: 2, rating: 4, reviewedAt: REVIEWED_AT })
  const [first, second] = [1, 2].map((index) => seededReviewId(seed.ids, index))
  return {
    organization,
    admin,
    manager,
    property,
    seed,
    reviewId: first!,
    otherReviewId: second!,
  }
}

/** A generation of the review's reply draft, written for `actor` as the draft path writes it. */
async function seedGeneration(
  scope: Awaited<ReturnType<typeof hotel>>,
  actor: Pick<TestMember, 'userId'>,
  overrides: Readonly<{ reviewId?: string; baseReplyRevision?: number }> = {},
): Promise<string> {
  const reviewId = overrides.reviewId ?? scope.reviewId
  const operationId = `${scope.seed.ids.idPrefix}-0001-4000-8000-${reviewId.slice(-12)}`
  const { rows } = await harness.pool().query<{ id: string }>(
    `INSERT INTO ai_draft_measurements
       (operation_id, organization_id, property_id, review_id, actor_user_id,
        request_key, contract, intent, trigger, tone, language, rating_band,
        provider_attempts, outcome, latency_ms, base_reply_revision, created_at)
     VALUES ($1, $2, $3, $4, $5, gen_random_uuid()::text, 'v1', 'explicit', 'draft',
             'professional', 'en-Latn-US', 'high', 1, 'ready', 100, $6, now())
     RETURNING id`,
    [
      operationId,
      scope.property.organizationId,
      scope.property.id,
      reviewId,
      actor.userId,
      overrides.baseReplyRevision ?? BASE_REVISION,
    ],
  )
  return rows[0]!.id
}

async function measurement(id: string): Promise<MeasurementRow> {
  const { rows } = await harness.pool().query<MeasurementRow>(
    `SELECT shown_at, draft_pressed, try_again_pressed, shorter_pressed, tone_pressed
         FROM ai_draft_measurements WHERE id = $1`,
    [id],
  )
  return rows[0]!
}

function event(
  reviewId: string,
  generationId: string,
  name: 'shown' | 'draft' | 'try_again' | 'shorter' | 'tone' = 'shown',
  baseReplyRevision = BASE_REVISION,
) {
  return { reviewId, generationId, baseReplyRevision, event: name }
}

async function noMeasurementMoved(ids: readonly string[]) {
  for (const id of ids) {
    expect(await measurement(id)).toMatchObject({
      shown_at: null,
      draft_pressed: false,
      try_again_pressed: false,
      shorter_pressed: false,
      tone_pressed: false,
    })
  }
}

describe('recordDraftMeasurementFn', () => {
  it('stamps shown on the AccountAdmin’s own generation and answers nothing', async () => {
    const scope = await hotel()
    const generationId = await seedGeneration(scope, scope.admin)

    const result = await harness.callAs(scope.admin, () =>
      recordDraftMeasurementFn({ data: event(scope.reviewId, generationId) }),
    )

    expect(result).toBeUndefined()
    expect((await measurement(generationId)).shown_at).toBeInstanceOf(Date)
  })

  it.each([
    ['draft', 'draft_pressed'],
    ['try_again', 'try_again_pressed'],
    ['shorter', 'shorter_pressed'],
    ['tone', 'tone_pressed'],
  ] as const)('sets the %s button flag', async (name, column) => {
    const scope = await hotel()
    const generationId = await seedGeneration(scope, scope.admin)

    await harness.callAs(scope.admin, () =>
      recordDraftMeasurementFn({ data: event(scope.reviewId, generationId, name) }),
    )

    expect((await measurement(generationId))[column]).toBe(true)
  })

  it('records for a PropertyManager the Property was granted to', async () => {
    const scope = await hotel()
    const generationId = await seedGeneration(scope, scope.manager)

    await harness.callAs(scope.manager, () =>
      recordDraftMeasurementFn({ data: event(scope.reviewId, generationId) }),
    )

    expect((await measurement(generationId)).shown_at).toBeInstanceOf(Date)
  })

  it('refuses a PropertyManager the Property was not granted to, and writes nothing', async () => {
    const scope = await hotel()
    const outsider = await harness.seedMember(scope.organization, 'PropertyManager')
    const generationId = await seedGeneration(scope, outsider)

    await expect(
      harness.callAs(outsider, () =>
        recordDraftMeasurementFn({ data: event(scope.reviewId, generationId) }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
    await noMeasurementMoved([generationId])
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const scope = await hotel()
    const member = await harness.seedMember(scope.organization, 'Member')
    const generationId = await seedGeneration(scope, member)

    await expect(
      harness.callAs(member, () =>
        recordDraftMeasurementFn({ data: event(scope.reviewId, generationId) }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    await noMeasurementMoved([generationId])
  })

  it('refuses a caller with no session', async () => {
    const scope = await hotel()
    const generationId = await seedGeneration(scope, scope.admin)

    await expect(
      harness.callAs(null, () =>
        recordDraftMeasurementFn({ data: event(scope.reviewId, generationId) }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
    await noMeasurementMoved([generationId])
  })

  it('writes nothing, and refuses nothing, for a review of another Organization', async () => {
    const scope = await hotel()
    const generationId = await seedGeneration(scope, scope.admin)
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    const result = await harness.callAs(otherAdmin, () =>
      recordDraftMeasurementFn({ data: event(scope.reviewId, generationId) }),
    )

    expect(result).toBeUndefined()
    await noMeasurementMoved([generationId])
  })

  it('touches only the caller’s generation of that review and revision', async () => {
    const scope = await hotel()
    const own = await seedGeneration(scope, scope.admin)
    const otherActors = await seedGeneration(scope, scope.manager)
    const otherReview = await seedGeneration(scope, scope.admin, {
      reviewId: scope.otherReviewId,
    })
    const otherRevision = await seedGeneration(scope, scope.admin, {
      baseReplyRevision: BASE_REVISION + 1,
    })

    await harness.callAs(scope.admin, () =>
      recordDraftMeasurementFn({ data: event(scope.reviewId, own, 'draft') }),
    )

    expect((await measurement(own)).draft_pressed).toBe(true)
    await noMeasurementMoved([otherActors, otherReview, otherRevision])
  })

  it.each([
    ['text of the draft', { text: 'PRIVATE DRAFT' }, /Unrecognized key/],
    ['reviewId that is not a UUID', { reviewId: 'review-1' }, /reviewId/],
    ['generationId that is not a UUID', { generationId: 'generation-1' }, /generationId/],
    ['unknown event', { event: 'published' }, /event/],
    ['negative revision', { baseReplyRevision: -1 }, /baseReplyRevision/],
  ])('refuses %s and leaves the row alone', async (_name, change, message) => {
    const scope = await hotel()
    const generationId = await seedGeneration(scope, scope.admin)

    await expect(
      harness.callAs(scope.admin, () =>
        recordDraftMeasurementFn({
          data: { ...event(scope.reviewId, generationId), ...change } as never,
        }),
      ),
    ).rejects.toThrow(message)
    await noMeasurementMoved([generationId])
  })
})
