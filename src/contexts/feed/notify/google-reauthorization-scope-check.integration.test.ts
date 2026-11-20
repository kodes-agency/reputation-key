// The database admits `integration.reauthorization_required` without a
// Property only in the one shape its Organization fallback writes: urgent,
// pointing at the Google connection. Everything else keeps its Property.
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { organizationId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'

const ORG_A = organizationId('b7300000-0000-4000-8000-000000000001')
const ORG_B = organizationId('b7300000-0000-4000-8000-000000000002')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['notifications'],
})

type Row = Readonly<{
  type: string
  category: string
  propertyId: string | null
  resourceType: string
}>

const insert = (row: Row) =>
  getPool().query(
    `INSERT INTO notifications
       (id, user_id, organization_id, property_id, type, category, priority, status,
        resource_type, resource_id, event_id, title)
     VALUES ($1, 'admin-1', $2, $3, $4, $5, 'normal', 'unread', $6, $7, $8, 'x')`,
    [
      randomUUID(),
      ORG_A,
      row.propertyId,
      row.type,
      row.category,
      row.resourceType,
      randomUUID(),
      randomUUID(),
    ],
  )

const refusal = (row: Row) =>
  insert(row).then(
    () => null,
    (error: unknown) => (error as { constraint?: string }).constraint,
  )

const reauthorization: Row = {
  type: 'integration.reauthorization_required',
  category: 'urgent_operational',
  propertyId: null,
  resourceType: 'integration',
}

describe('notification scope CHECK for the Google reauthorization fallback', () => {
  it('admits the Organization-scoped notice pointing at the connection', async () => {
    await expect(refusal(reauthorization)).resolves.toBeNull()
  })

  it('refuses it pointing anywhere but the connection, or in another category', async () => {
    await expect(
      refusal({ ...reauthorization, resourceType: 'organization' }),
    ).resolves.toBe('notifications_mandatory_scope_check')
    await expect(
      refusal({ ...reauthorization, category: 'workflow_collaboration' }),
    ).resolves.toBe('notifications_mandatory_scope_check')
  })

  it('still refuses any other urgent notice without a Property', async () => {
    await expect(
      refusal({ ...reauthorization, type: 'review.negative_received' }),
    ).resolves.toBe('notifications_mandatory_scope_check')
  })
})
