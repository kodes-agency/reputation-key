import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { createReviewSourceTransitionAuthority } from './source-transition-authority'

const ORG = organizationId('review-source-transition-authority-org')
const OTHER_ORG = organizationId('review-source-transition-authority-other')
const PROPERTY = propertyId(randomUUID())
const REVIEW = reviewId(randomUUID())
const OCCURRED_AT = new Date('2026-08-27T00:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: ['reviews'],
})

const expectation = {
  organizationId: ORG,
  propertyId: PROPERTY,
  reviewId: REVIEW,
  sourceEpoch: 0,
  sourceRevision: 3,
  analysisSequence: 7,
  change: 'source_expired',
  occurredAt: OCCURRED_AT,
} as const

beforeEach(async () => {
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
     VALUES ($1, $2, 'Source transition authority', 'source-transition-authority', 'UTC', 0)
     ON CONFLICT (id) DO UPDATE SET source_epoch = EXCLUDED.source_epoch`,
    [PROPERTY, ORG],
  )
  await getPool().query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, source_epoch,
       source_revision, analysis_sequence, source_content_state,
       source_content_erased_at
     ) VALUES ($1, $2, $3, 'google', 0, 3, 7, 'source_expired', $4)`,
    [REVIEW, ORG, PROPERTY, OCCURRED_AT],
  )
})

describe('Review source-transition exact-current authority', () => {
  it('grants only the exact current content-free transition while retaining the Review fence', async () => {
    const apply = vi.fn(async () => 'projection-committed')

    const result = await createReviewSourceTransitionAuthority(getDb()).withExactCurrent(
      expectation,
      apply,
    )

    expect(result).toEqual({ status: 'current', value: 'projection-committed' })
    expect(apply).toHaveBeenCalledWith({
      authority: 'review.current-source-transition.v1',
      ...expectation,
    })
  })

  it.each([
    [
      're-observed state',
      `source_content_state = 'active', source_content_erased_at = NULL`,
    ],
    ['newer analysis head', 'analysis_sequence = 8'],
    ['different transition clock', `source_content_erased_at = '2026-08-27T00:00:01Z'`],
  ])('refuses an obsolete event after %s', async (_case, mutation) => {
    await getPool().query(`UPDATE reviews SET ${mutation} WHERE id = $1`, [REVIEW])
    const apply = vi.fn(async () => 'must-not-run')

    const result = await createReviewSourceTransitionAuthority(getDb()).withExactCurrent(
      expectation,
      apply,
    )

    expect(result).toEqual({ status: 'obsolete' })
    expect(apply).not.toHaveBeenCalled()
  })
})
