import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import {
  GUEST_UPDATE_TIME,
  cleanRestatedRevisionScope,
  excludeCycle,
  seedRestatedRevisionItem,
  seedScope,
} from '#/shared/testing/restated-revision-fixtures'

const ORG = 'org-target-exclusion-ledger'
const PROPERTY = 'e8c40000-0000-4000-8000-000000000001'
const OTHER_PROPERTY = 'e8c40000-0000-4000-8000-000000000002'
const ITEM = 'e8c40000-0000-4000-8000-000000000101'
const REVIEW = 'e8c40000-0000-4000-8000-000000000201'

let pool: Pool

const scope = (cycleNumber: number) => ({
  organizationId: ORG,
  propertyId: PROPERTY,
  itemId: ITEM,
  cycleNumber,
})

const exclusionCount = async (): Promise<number> => {
  const result = await pool.query<{ total: string }>(
    'SELECT count(*) AS total FROM inbox_response_target_exclusions WHERE organization_id = $1',
    [ORG],
  )
  return Number(result.rows[0]?.total)
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
    slug: 'target-exclusion-ledger',
    at: GUEST_UPDATE_TIME,
    properties: [
      { id: PROPERTY, name: 'Ledger Property', slug: 'ledger-property' },
      { id: OTHER_PROPERTY, name: 'Other Property', slug: 'other-property' },
    ],
  })
  await seedRestatedRevisionItem(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: REVIEW,
    itemId: ITEM,
    outcome: 'open',
  })
})

describe.sequential('inbox_response_target_exclusions (PostgreSQL)', () => {
  it('records an exclusion for a Google target with the operator trail', async () => {
    await excludeCycle(pool, {
      ...scope(2),
      operatorId: 'operator-ledger',
      ticket: 'OPS-70',
      correlationId: '11111111-2222-4333-8444-555555555555',
    })

    const rows = await pool.query(
      `SELECT target_kind, reason, operator_id, ticket, correlation_id
         FROM inbox_response_target_exclusions WHERE organization_id = $1`,
      [ORG],
    )

    expect(rows.rows).toEqual([
      {
        target_kind: 'google_review_response',
        reason: 'provider_restatement',
        operator_id: 'operator-ledger',
        ticket: 'OPS-70',
        correlation_id: '11111111-2222-4333-8444-555555555555',
      },
    ])
  })

  it('refuses to rewrite an exclusion row', async () => {
    await excludeCycle(pool, scope(2))

    await expect(
      pool.query(
        `UPDATE inbox_response_target_exclusions SET operator_id = 'someone-else'
          WHERE inbox_item_id = $1 AND organization_id = $2`,
        [ITEM, ORG],
      ),
    ).rejects.toThrow(/Response Target exclusions are append-only/)
  })

  it('refuses to delete an exclusion row directly', async () => {
    await excludeCycle(pool, scope(2))

    await expect(
      pool.query(
        'DELETE FROM inbox_response_target_exclusions WHERE inbox_item_id = $1',
        [ITEM],
      ),
    ).rejects.toThrow(/Response Target exclusions are append-only/)
    expect(await exclusionCount()).toBe(1)
  })

  it('goes with its target when the Inbox item is deleted', async () => {
    await excludeCycle(pool, scope(2))

    await pool.query('DELETE FROM inbox_items WHERE id = $1 AND organization_id = $2', [
      ITEM,
      ORG,
    ])

    expect(await exclusionCount()).toBe(0)
  })

  it('refuses a second exclusion of the same cycle and lets ON CONFLICT DO NOTHING absorb it', async () => {
    await excludeCycle(pool, scope(2))

    await expect(excludeCycle(pool, scope(2))).rejects.toThrow(
      /inbox_response_target_exclusions_pk/,
    )
    const absorbed = await pool.query(
      `INSERT INTO inbox_response_target_exclusions (
         organization_id, property_id, inbox_item_id, cycle_number, target_kind,
         reason, correlation_id, operator_id
       ) VALUES ($1, $2, $3, 2, 'google_review_response', 'provider_restatement',
                 gen_random_uuid(), 'operator-ledger')
       ON CONFLICT DO NOTHING`,
      [ORG, PROPERTY, ITEM],
    )
    expect(absorbed.rowCount).toBe(0)
    expect(await exclusionCount()).toBe(1)
  })

  it('refuses an exclusion for a cycle with no target, another Property, or another kind', async () => {
    await expect(excludeCycle(pool, scope(3))).rejects.toThrow(
      /inbox_response_target_exclusions_target_scope_fk/,
    )
    await expect(
      excludeCycle(pool, { ...scope(2), propertyId: OTHER_PROPERTY }),
    ).rejects.toThrow(/inbox_response_target_exclusions_target_scope_fk/)
    await expect(
      pool.query(
        `INSERT INTO inbox_response_target_exclusions (
           organization_id, property_id, inbox_item_id, cycle_number, target_kind,
           reason, correlation_id, operator_id
         ) VALUES ($1, $2, $3, 2, 'private_feedback_handling', 'provider_restatement',
                   gen_random_uuid(), 'operator-ledger')`,
        [ORG, PROPERTY, ITEM],
      ),
    ).rejects.toThrow(/violates/)
    expect(await exclusionCount()).toBe(0)
  })

  it('accepts only the reason the ledger knows and an operator trail that is not blank', async () => {
    const insert = (reason: string, operator: string, ticket: string | null) =>
      pool.query(
        `INSERT INTO inbox_response_target_exclusions (
           organization_id, property_id, inbox_item_id, cycle_number, target_kind,
           reason, correlation_id, operator_id, ticket
         ) VALUES ($1, $2, $3, 2, 'google_review_response', $4,
                   gen_random_uuid(), $5, $6)`,
        [ORG, PROPERTY, ITEM, reason, operator, ticket],
      )

    await expect(insert('guest_withdrew', 'operator-ledger', null)).rejects.toThrow(
      /inbox_response_target_exclusions_values_valid/,
    )
    await expect(insert('provider_restatement', '   ', null)).rejects.toThrow(
      /inbox_response_target_exclusions_values_valid/,
    )
    await expect(insert('provider_restatement', 'operator-ledger', ' ')).rejects.toThrow(
      /inbox_response_target_exclusions_values_valid/,
    )
    expect(await exclusionCount()).toBe(0)
  })
})
