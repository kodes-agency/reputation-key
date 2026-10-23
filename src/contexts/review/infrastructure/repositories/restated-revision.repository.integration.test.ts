import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  cleanRestatedRevisionScope,
  seedReview,
  seedScope,
  type ObservationFixture,
} from '#/shared/testing/restated-revision-fixtures'
import { createRestatedRevisionQuery } from './restated-revision.repository'

const ORG = organizationId('org-restated-revision-read')
const PROPERTY = propertyId('e8c10000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('e8c10000-0000-4000-8000-000000000002')

const RESTATED = reviewId('e8c10000-0000-4000-8000-000000000a01')
const REAL_EDIT = reviewId('e8c10000-0000-4000-8000-000000000a02')
const FIRST_ONLY = reviewId('e8c10000-0000-4000-8000-000000000a03')
const NO_NEW_REVISION = reviewId('e8c10000-0000-4000-8000-000000000a04')
const OUT_OF_ORDER_BETWEEN = reviewId('e8c10000-0000-4000-8000-000000000a05')
const OTHER_EPOCH = reviewId('e8c10000-0000-4000-8000-000000000a06')
const NO_TIME = reviewId('e8c10000-0000-4000-8000-000000000a07')
const REAL_THEN_RESTATED = reviewId('e8c10000-0000-4000-8000-000000000a08')
const OTHER_PROPERTY_REVIEW = reviewId('e8c10000-0000-4000-8000-000000000a09')

const AT = new Date('2026-10-23T08:00:00.000Z')
const GUEST_TIME = new Date('2026-01-10T09:00:00.000Z')
const LATER_GUEST_TIME = new Date('2026-03-02T09:00:00.000Z')
const OBSERVED_FIRST = new Date('2026-09-05T10:00:00.000Z')

const db = getDb()
let pool: Pool

function observation(
  sequence: number,
  materialRevision: number,
  comparison: ObservationFixture['comparison'],
  sourceUpdatedAt: Date | null,
  extra: Partial<ObservationFixture> = {},
): ObservationFixture {
  return {
    sequence,
    materialRevision,
    comparison,
    sourceUpdatedAt,
    observedAt: new Date(OBSERVED_FIRST.getTime() + sequence * 86_400_000),
    ...extra,
  }
}

async function seedHistory(
  id: typeof RESTATED,
  property: typeof PROPERTY,
  revisions: ReadonlyArray<number>,
  observations: ReadonlyArray<ObservationFixture>,
  revisionEpochs: Readonly<Record<number, number>> = {},
): Promise<void> {
  await seedReview(pool, {
    organizationId: ORG,
    propertyId: property,
    reviewId: id,
    createdAt: AT,
    revisions: revisions.map((revision) => ({
      revision,
      sourceEpoch: revisionEpochs[revision] ?? 0,
      eligibility: 'measured',
      startAt: GUEST_TIME,
    })),
    observations,
  })
}

beforeAll(() => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
})

afterAll(async () => {
  await cleanRestatedRevisionScope(pool, ORG)
  await pool.end()
})

beforeEach(async () => {
  await cleanRestatedRevisionScope(pool, ORG)
  await seedScope(pool, {
    organizationId: ORG,
    slug: 'restated-revision-read',
    at: AT,
    properties: [
      { id: PROPERTY, name: 'Restated Property', slug: 'restated-property' },
      { id: OTHER_PROPERTY, name: 'Other Property', slug: 'other-property' },
    ],
  })
})

describe.sequential('Review restated Material Review Revisions (PostgreSQL)', () => {
  it('lists exactly the material changes whose Google update time did not move', async () => {
    await seedHistory(
      RESTATED,
      PROPERTY,
      [1, 2],
      [
        observation(1, 1, 'initial_material_revision', GUEST_TIME),
        observation(2, 2, 'material_change', GUEST_TIME),
      ],
    )
    await seedHistory(
      REAL_EDIT,
      PROPERTY,
      [1, 2],
      [
        observation(1, 1, 'initial_material_revision', GUEST_TIME),
        observation(2, 2, 'material_change', LATER_GUEST_TIME),
      ],
    )
    await seedHistory(
      FIRST_ONLY,
      PROPERTY,
      [1],
      [observation(1, 1, 'initial_material_revision', GUEST_TIME)],
    )
    await seedHistory(
      NO_NEW_REVISION,
      PROPERTY,
      [1],
      [
        observation(1, 1, 'initial_material_revision', GUEST_TIME),
        // A restatement since the rule: stored as the shadow match, no revision.
        observation(2, 1, 'normalization_shadow_match', GUEST_TIME),
      ],
    )
    await seedHistory(
      OTHER_PROPERTY_REVIEW,
      OTHER_PROPERTY,
      [1, 2],
      [
        observation(1, 1, 'initial_material_revision', GUEST_TIME),
        observation(2, 2, 'material_change', GUEST_TIME),
      ],
    )

    const restated = await createRestatedRevisionQuery(db).listRestatedRevisions({
      organizationId: ORG,
      propertyId: PROPERTY,
    })

    expect(restated).toEqual([{ reviewId: RESTATED, sourceEpoch: 0, revision: 2 }])
  })

  it('compares with the last applied observation, skipping one recorded as out of order', async () => {
    await seedHistory(
      OUT_OF_ORDER_BETWEEN,
      PROPERTY,
      [1, 2],
      [
        observation(1, 1, 'initial_material_revision', LATER_GUEST_TIME),
        observation(2, 1, 'out_of_order_ignored', GUEST_TIME),
        observation(3, 2, 'material_change', LATER_GUEST_TIME),
      ],
    )

    const restated = await createRestatedRevisionQuery(db).listRestatedRevisions({
      organizationId: ORG,
      propertyId: PROPERTY,
    })

    expect(restated).toEqual([
      { reviewId: OUT_OF_ORDER_BETWEEN, sourceEpoch: 0, revision: 2 },
    ])
  })

  it('does not list a change that crossed a source epoch or lacks either update time', async () => {
    await seedHistory(
      OTHER_EPOCH,
      PROPERTY,
      [1, 2],
      [
        observation(1, 1, 'initial_material_revision', GUEST_TIME),
        observation(2, 2, 'material_change', GUEST_TIME, { sourceEpoch: 1 }),
      ],
      { 2: 1 },
    )
    await seedHistory(
      NO_TIME,
      PROPERTY,
      [1, 2],
      [
        observation(1, 1, 'initial_material_revision', null),
        observation(2, 2, 'material_change', null),
      ],
    )

    const restated = await createRestatedRevisionQuery(db).listRestatedRevisions({
      organizationId: ORG,
      propertyId: PROPERTY,
    })

    expect(restated).toEqual([])
  })

  it('lists only the restated revision of a Review that also had a real edit', async () => {
    await seedHistory(
      REAL_THEN_RESTATED,
      PROPERTY,
      [1, 2, 3],
      [
        observation(1, 1, 'initial_material_revision', GUEST_TIME),
        observation(2, 2, 'material_change', LATER_GUEST_TIME),
        observation(3, 3, 'material_change', LATER_GUEST_TIME),
      ],
    )

    const restated = await createRestatedRevisionQuery(db).listRestatedRevisions({
      organizationId: ORG,
      propertyId: PROPERTY,
    })

    expect(restated).toEqual([
      { reviewId: REAL_THEN_RESTATED, sourceEpoch: 0, revision: 3 },
    ])
  })

  it('reads nothing from another organization with the same Property id', async () => {
    await seedHistory(
      RESTATED,
      PROPERTY,
      [1, 2],
      [
        observation(1, 1, 'initial_material_revision', GUEST_TIME),
        observation(2, 2, 'material_change', GUEST_TIME),
      ],
    )

    const restated = await createRestatedRevisionQuery(db).listRestatedRevisions({
      organizationId: organizationId('org-restated-revision-read-other'),
      propertyId: PROPERTY,
    })

    expect(restated).toEqual([])
  })
})
