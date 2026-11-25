// Migration 0160: the Inbox row carries the Material Review Revision its current
// Handling Cycle rests on, and a foreign key from it keeps that revision alive.
// The Handling Cycle head table used to be the only thing that did.

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

const ORG = 'org-inbox-material-revision-fk'
const PROPERTY = 'e8c50000-0000-4000-8000-000000000001'
const REVIEW = 'e8c50000-0000-4000-8000-000000000201'
const FEEDBACK_SOURCE = 'e8c50000-0000-4000-8000-000000000301'
const ITEM = 'e8c50000-0000-4000-8000-000000000101'
const FEEDBACK_ITEM = 'e8c50000-0000-4000-8000-000000000102'
const CONSTRAINT = 'inbox_items_material_revision_fk'
const FOREIGN_KEY_VIOLATION = '23503'
const REVISION_THE_CYCLE_OPENED_ON = 1
const REVISION_CARRIED_TO = 2
const REVISION_NOBODY_POINTS_AT = 3

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
    slug: 'inbox-material-revision-fk',
    at: GUEST_UPDATE_TIME,
    properties: [{ id: PROPERTY, name: 'Revision Property', slug: 'revision-property' }],
  })
  await seedReview(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: REVIEW,
    createdAt: GUEST_UPDATE_TIME,
    revisions: [
      {
        revision: REVISION_THE_CYCLE_OPENED_ON,
        eligibility: 'historical_onboarding',
        startAt: null,
      },
      {
        revision: REVISION_CARRIED_TO,
        eligibility: 'historical_onboarding',
        startAt: null,
      },
      {
        revision: REVISION_NOBODY_POINTS_AT,
        eligibility: 'historical_onboarding',
        startAt: null,
      },
    ],
  })
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
        revision: REVISION_THE_CYCLE_OPENED_ON,
        openedReason: 'review_observed',
        openedAt: GUEST_UPDATE_TIME,
        target: { eligibility: 'historical_onboarding', startAt: null },
      },
    ],
  })
  // The retired head table must not be what protects the revision.
  await pool.query('DELETE FROM inbox_handling_cycle_heads WHERE organization_id = $1', [
    ORG,
  ])
})

async function setRevisionOnItem(revision: number | null): Promise<void> {
  await pool.query(
    'UPDATE inbox_items SET current_material_review_revision = $2 WHERE id = $1',
    [ITEM, revision],
  )
}

async function deleteRevision(revision: number): Promise<void> {
  await pool.query(
    'DELETE FROM material_review_revisions WHERE review_id = $1 AND revision = $2',
    [REVIEW, revision],
  )
}

describe('inbox_items_material_revision_fk', () => {
  it('refuses to delete the revision an Inbox row carries, with no head row beside it', async () => {
    await setRevisionOnItem(REVISION_CARRIED_TO)

    await expect(deleteRevision(REVISION_CARRIED_TO)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
      constraint: CONSTRAINT,
    })

    const kept = await pool.query(
      'SELECT 1 FROM material_review_revisions WHERE review_id = $1 AND revision = $2',
      [REVIEW, REVISION_CARRIED_TO],
    )
    expect(kept.rowCount).toBe(1)
  })

  it('leaves a revision no Inbox row carries deletable', async () => {
    await setRevisionOnItem(REVISION_CARRIED_TO)

    await deleteRevision(REVISION_NOBODY_POINTS_AT)

    const left = await pool.query<{ revision: string }>(
      'SELECT revision FROM material_review_revisions WHERE review_id = $1 ORDER BY revision',
      [REVIEW],
    )
    expect(left.rows.map((row) => Number(row.revision))).toEqual([
      REVISION_THE_CYCLE_OPENED_ON,
      REVISION_CARRIED_TO,
    ])
  })

  it('lets the revision go once the Inbox item is gone, as an erasure deletes it', async () => {
    await setRevisionOnItem(REVISION_CARRIED_TO)
    await pool.query('DELETE FROM inbox_items WHERE id = $1', [ITEM])

    await deleteRevision(REVISION_CARRIED_TO)

    const left = await pool.query(
      'SELECT 1 FROM material_review_revisions WHERE review_id = $1 AND revision = $2',
      [REVIEW, REVISION_CARRIED_TO],
    )
    expect(left.rowCount).toBe(0)
  })

  it('refuses a revision the Review does not have', async () => {
    await expect(setRevisionOnItem(99)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
      constraint: CONSTRAINT,
    })
  })

  it('does not check an Inbox row that carries no revision', async () => {
    await setRevisionOnItem(null)

    await deleteRevision(REVISION_CARRIED_TO)
  })

  it('does not tie a feedback item to any Review revision', async () => {
    await pool.query(
      `INSERT INTO inbox_items (
         id, organization_id, property_id, source_type, source_id, status,
         source_date, command_revision, created_at, updated_at
       ) VALUES ($1, $2, $3, 'feedback', $4, 'open', $5, 1, $5, $5)`,
      [FEEDBACK_ITEM, ORG, PROPERTY, FEEDBACK_SOURCE, GUEST_UPDATE_TIME],
    )

    const row = await pool.query<{ current_material_review_revision: string | null }>(
      'SELECT current_material_review_revision FROM inbox_items WHERE id = $1',
      [FEEDBACK_ITEM],
    )
    expect(row.rows[0]?.current_material_review_revision).toBeNull()
  })
})
