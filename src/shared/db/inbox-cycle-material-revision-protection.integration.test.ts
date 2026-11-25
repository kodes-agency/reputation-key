// The Handling Cycle head table used to carry a RESTRICT foreign key to the
// Material Review Revision. It is retired and no longer written; the revision an
// Inbox item's current cycle is anchored to stays protected by the cycle row's
// own key, `inbox_handling_cycles_material_revision_fk`.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import {
  GUEST_UPDATE_TIME,
  cleanRestatedRevisionScope,
  seedInboxItem,
  seedReview,
  seedScope,
} from '#/shared/testing/restated-revision-fixtures'

const ORG = 'org-inbox-cycle-revision-protection'
const PROPERTY = 'e8c60000-0000-4000-8000-000000000001'
const REVIEW = 'e8c60000-0000-4000-8000-000000000201'
const ITEM = 'e8c60000-0000-4000-8000-000000000101'
const CONSTRAINT = 'inbox_handling_cycles_material_revision_fk'
const FOREIGN_KEY_VIOLATION = '23503'
const CYCLE_REVISION = 1
const UNREFERENCED_REVISION = 2

let pool: Pool

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
    slug: 'inbox-cycle-revision-protection',
    at: GUEST_UPDATE_TIME,
    properties: [
      { id: PROPERTY, name: 'Revision Property', slug: 'revision-protection' },
    ],
  })
  await seedReview(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: REVIEW,
    createdAt: GUEST_UPDATE_TIME,
    revisions: [CYCLE_REVISION, UNREFERENCED_REVISION].map((revision) => ({
      revision,
      eligibility: 'historical_onboarding' as const,
      startAt: null,
    })),
  })
  // The item and its one cycle, with no Handling Cycle head row beside them.
  await seedInboxItem(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: REVIEW,
    itemId: ITEM,
    status: 'open',
    createdAt: GUEST_UPDATE_TIME,
    cycles: [
      {
        number: 1,
        revision: CYCLE_REVISION,
        openedReason: 'review_observed',
        openedAt: GUEST_UPDATE_TIME,
        target: { eligibility: 'historical_onboarding', startAt: null },
      },
    ],
  })
})

const deleteRevision = (revision: number) =>
  pool.query(
    'DELETE FROM material_review_revisions WHERE review_id = $1 AND revision = $2',
    [REVIEW, revision],
  )

const revisionCount = async (revision: number): Promise<number> =>
  (
    await pool.query(
      'SELECT 1 FROM material_review_revisions WHERE review_id = $1 AND revision = $2',
      [REVIEW, revision],
    )
  ).rowCount ?? 0

describe('the revision an Inbox item current cycle is anchored to', () => {
  it('is seeded without a head row', async () => {
    const heads = await pool.query(
      'SELECT 1 FROM inbox_handling_cycle_heads WHERE inbox_item_id = $1',
      [ITEM],
    )
    expect(heads.rowCount).toBe(0)
  })

  it('cannot be deleted while the current cycle row names it', async () => {
    await expect(deleteRevision(CYCLE_REVISION)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
      constraint: CONSTRAINT,
    })
    expect(await revisionCount(CYCLE_REVISION)).toBe(1)
  })

  it('leaves a revision no cycle names deletable', async () => {
    await deleteRevision(UNREFERENCED_REVISION)

    expect(await revisionCount(UNREFERENCED_REVISION)).toBe(0)
    expect(await revisionCount(CYCLE_REVISION)).toBe(1)
  })

  it('can be deleted once the item and its cycles are gone, as an erasure deletes it', async () => {
    await pool.query('DELETE FROM inbox_items WHERE id = $1', [ITEM])

    await deleteRevision(CYCLE_REVISION)

    expect(await revisionCount(CYCLE_REVISION)).toBe(0)
  })
})
