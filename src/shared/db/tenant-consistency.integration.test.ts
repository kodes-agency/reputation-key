import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

type TenantMismatchRow = Readonly<{
  source: 'inbox_items' | 'operational_action_history_records'
  id: string
}>

describe('varchar-backed property tenant consistency', () => {
  let lease: TestLease

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })

  afterAll(async () => {
    await lease?.release()
  })

  it('has no property reference whose owning organization differs from the row', async () => {
    const result = await lease.pool.query<TenantMismatchRow>(`
      SELECT 'inbox_items' AS source, item.id::text AS id
      FROM inbox_items AS item
      JOIN properties AS property ON property.id = CASE
        WHEN item.property_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN item.property_id::uuid
        ELSE NULL
      END
      WHERE property.organization_id <> item.organization_id

      UNION ALL

      SELECT 'operational_action_history_records' AS source, history.id::text AS id
      FROM operational_action_history_records AS history
      JOIN properties AS property ON property.id = CASE
        WHEN history.property_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN history.property_id::uuid
        ELSE NULL
      END
      WHERE property.organization_id <> history.organization_id
    `)

    expect(result.rows).toEqual([])
  })
})
