import { describe, expect, it } from 'vitest'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import {
  notifications,
  notificationPreferences,
  notificationPropertyDeliveryWindows,
} from './notification.schema'

function indexColumns(table: PgTable, name: string): readonly string[] {
  const found = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name,
  )
  if (!found) throw new Error(`missing index ${name}`)
  return found.config.columns.map((column) =>
    'name' in column && typeof column.name === 'string' ? column.name : String(column),
  )
}

// database-06: each table carries a (organization_id, property_id) tenant FK
// ON DELETE CASCADE, but had no index leading with that pair — a Property
// hard delete's cascade check for these FKs had no way to narrow to the
// deleted property.
describe('notification tables — property-scoped tenant indexes', () => {
  it('leads notifications with (organization_id, property_id)', () => {
    expect(indexColumns(notifications, 'notifications_org_property_idx')).toEqual([
      'organization_id',
      'property_id',
    ])
  })

  it('leads notification_preferences with (organization_id, property_id)', () => {
    expect(
      indexColumns(notificationPreferences, 'notification_preferences_org_property_idx'),
    ).toEqual(['organization_id', 'property_id'])
  })

  it('leads notification_property_delivery_windows with (organization_id, property_id)', () => {
    expect(
      indexColumns(
        notificationPropertyDeliveryWindows,
        'notification_property_delivery_windows_org_property_idx',
      ),
    ).toEqual(['organization_id', 'property_id'])
  })
})
