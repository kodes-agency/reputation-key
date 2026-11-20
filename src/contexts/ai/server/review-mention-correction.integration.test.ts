// "Not right?" corrections to a review's analysis, made as signed-in members
// over PostgreSQL with the real tenant resolution, execution policy and stores.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, expect, it, vi } from 'vitest'
import {
  setupServerFunctionHarness,
  type TestMember,
} from '#/shared/testing/server-function-harness'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'
import { mentionOf, seededReviewId, useAiSeeds } from './ai-seed.test-fixtures'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import { correctReviewMentionFn } from './review-mention-correction'

const harness = setupServerFunctionHarness({
  cleanupTables: ['ai_review_analysis_mention_corrections', ...REVIEW_SEED_TABLES],
})
const seedAi = useAiSeeds(GOOGLE_LOCATION_PRIMARY_RESOURCE)

const REVIEWED_AT = new Date('2026-10-12T16:00:00Z')
const AIR_CONDITIONING = mentionOf({
  topic: 'facilities_equipment',
  polarity: 'negative',
  thing: 'air conditioning',
  issue: 'not working',
  sentences: [1],
})
const STAFF_PRAISE = mentionOf({
  topic: 'staff_service',
  polarity: 'positive',
  sentences: [2],
})

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  const seed = await seedAi(property)
  await seed.setUp()
  const review = {
    index: 1,
    rating: 2,
    reviewedAt: REVIEWED_AT,
    mentions: [AIR_CONDITIONING, STAFF_PRAISE],
  } as const
  await seed.addReview(review)
  await seed.seal()
  return {
    organization,
    admin,
    manager,
    property,
    seed,
    review,
    reviewId: seededReviewId(seed.ids, 1),
  }
}

type Hotel = Awaited<ReturnType<typeof hotel>>

function correct(
  scope: Hotel,
  caller: TestMember | null,
  fields: Readonly<{
    mentionOrdinal?: number
    analysisSequence?: number
    action: unknown
    reviewId?: string
  }>,
) {
  return harness.callAs(caller, () =>
    correctReviewMentionFn({
      data: {
        reviewId: fields.reviewId ?? scope.reviewId,
        analysisSequence: fields.analysisSequence ?? 1,
        mentionOrdinal: fields.mentionOrdinal ?? 0,
        action: fields.action,
      },
    } as never),
  )
}

async function corrections(scope: Hotel) {
  const { rows } = await harness.pool().query<{
    mention_ordinal: number
    kind: string
    replacement_thing: string | null
    replacement_issue: string | null
  }>(
    `SELECT mention_ordinal, kind, replacement_thing, replacement_issue
       FROM ai_review_analysis_mention_corrections
      WHERE organization_id = $1 ORDER BY mention_ordinal`,
    [scope.property.organizationId],
  )
  return rows
}

async function giveReviewWords(scope: Hotel, text: string) {
  await harness
    .pool()
    .query(`UPDATE review_source_contents SET text = $2 WHERE review_id = $1`, [
      scope.reviewId,
      text,
    ])
}

describe('correctReviewMentionFn', () => {
  it('sets a topic aside for an AccountAdmin and keeps the correction', async () => {
    const scope = await hotel()

    const result = await correct(scope, scope.admin, {
      action: { kind: 'remove_topic' },
    })

    expect(result).toEqual({ status: 'applied', mentionOrdinals: [0] })
    expect(await corrections(scope)).toMatchObject([
      { mention_ordinal: 0, kind: 'remove_topic' },
    ])
  })

  it('stores a changed cause folded to lowercase, and an undo gives it back', async () => {
    const scope = await hotel()

    const changed = await correct(scope, scope.admin, {
      action: { kind: 'change_cause', thing: 'Shower', issue: 'too cold' },
    })
    expect(changed).toMatchObject({ status: 'applied' })
    expect(await corrections(scope)).toMatchObject([
      {
        kind: 'change_cause',
        replacement_thing: 'shower',
        replacement_issue: 'too cold',
      },
    ])

    const undone = await correct(scope, scope.admin, { action: { kind: 'undo' } })
    expect(undone).toEqual({ status: 'cleared', mentionOrdinals: [0] })
    expect(await corrections(scope)).toEqual([])
  })

  it('refuses a changed cause that quotes the review’s words, and stores nothing', async () => {
    const scope = await hotel()
    await giveReviewWords(scope, 'The shower ran cold every morning.')

    const result = await correct(scope, scope.admin, {
      action: {
        kind: 'change_cause',
        thing: 'shower ran',
        issue: 'cold every',
      },
    })

    expect(result).toEqual({ status: 'invalid_cause' })
    expect(await corrections(scope)).toEqual([])
  })

  it('skips the quotation check when Review no longer serves the words', async () => {
    const scope = await hotel()
    await giveReviewWords(scope, 'The shower ran cold every morning.')
    await harness.pool().query(
      `UPDATE review_source_contents
            SET content_expires_at = now() - interval '1 day' WHERE review_id = $1`,
      [scope.reviewId],
    )

    const result = await correct(scope, scope.admin, {
      action: {
        kind: 'change_cause',
        thing: 'shower ran',
        issue: 'cold every',
      },
    })

    expect(result).toMatchObject({ status: 'applied' })
    expect(await corrections(scope)).toHaveLength(1)
  })

  it('lets a PropertyManager the Property was granted to correct a mention', async () => {
    const scope = await hotel()

    const result = await correct(scope, scope.manager, {
      action: { kind: 'remove_topic' },
    })

    expect(result).toMatchObject({ status: 'applied' })
  })

  it('refuses a PropertyManager without the grant before saying anything about the reading', async () => {
    const scope = await hotel()
    const outsider = await harness.seedMember(scope.organization, 'PropertyManager')

    await expect(
      correct(scope, outsider, {
        analysisSequence: 99,
        action: { kind: 'remove_topic' },
      }),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
    expect(await corrections(scope)).toEqual([])
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const scope = await hotel()
    const member = await harness.seedMember(scope.organization, 'Member')

    await expect(
      correct(scope, member, { action: { kind: 'remove_topic' } }),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    expect(await corrections(scope)).toEqual([])
  })

  it('refuses a caller with no session', async () => {
    const scope = await hotel()

    await expect(
      correct(scope, null, { action: { kind: 'remove_topic' } }),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('does not find a review that does not exist', async () => {
    const scope = await hotel()

    await expect(
      correct(scope, scope.admin, {
        reviewId: '00000000-0000-4000-8000-000000000999',
        action: { kind: 'remove_topic' },
      }),
    ).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
      message: 'Review not found',
    })
  })

  it('does not find a review of another Organization, and writes nothing', async () => {
    const scope = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      correct(scope, otherAdmin, { action: { kind: 'remove_topic' } }),
    ).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
      message: 'Review not found',
    })
    expect(await corrections(scope)).toEqual([])
  })

  it('answers not found, writing nothing, once the review has been read again', async () => {
    const scope = await hotel()
    await scope.seed.reanalyze({ ...scope.review, sequence: 5 })

    const result = await correct(scope, scope.admin, {
      analysisSequence: 1,
      action: { kind: 'remove_topic' },
    })

    expect(result).toEqual({ status: 'not_found' })
    expect(await corrections(scope)).toEqual([])
  })

  it('answers disabled while AI is not enabled for the Property', async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')
    const property = await harness.seedProperty(organization)
    const review = await harness.seedReview(property)

    const result = await harness.callAs(admin, () =>
      correctReviewMentionFn({
        data: {
          reviewId: review.id,
          analysisSequence: 1,
          mentionOrdinal: 0,
          action: { kind: 'remove_topic' },
        },
      }),
    )

    expect(result).toEqual({ status: 'disabled' })
  })

  it.each([
    [
      'a missing reading',
      { analysisSequence: undefined, mentionOrdinal: 0, action: { kind: 'undo' } },
      /analysisSequence/,
    ],
    [
      'an ordinal beyond the answer’s bound',
      { mentionOrdinal: 48, action: { kind: 'undo' } },
      /mentionOrdinal/,
    ],
    [
      'a negative ordinal',
      { mentionOrdinal: -1, action: { kind: 'undo' } },
      /mentionOrdinal/,
    ],
    ['an unknown action', { mentionOrdinal: 0, action: { kind: 'hide' } }, /action/],
    [
      'an action with a stray field',
      { mentionOrdinal: 0, action: { kind: 'undo', note: 'x' } },
      /action/,
    ],
    [
      'a cause phrase far over its bound',
      {
        mentionOrdinal: 0,
        action: { kind: 'change_cause', thing: 'x'.repeat(81), issue: null },
      },
      /thing/,
    ],
  ])('refuses %s and writes nothing', async (_name, rest, message) => {
    const scope = await hotel()

    await expect(
      harness.callAs(scope.admin, () =>
        correctReviewMentionFn({
          data: { reviewId: scope.reviewId, analysisSequence: 1, ...rest },
        } as never),
      ),
    ).rejects.toThrow(message)
    expect(await corrections(scope)).toEqual([])
  })
})
