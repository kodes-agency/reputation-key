import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { portalGroups } from './portal-group.schema'

// database-01: portal_groups used to carry two independent foreign keys into
// `properties` — an inline single-column CASCADE plus the composite tenant
// RESTRICT — with no guaranteed firing order between their triggers. The
// CASCADE path let an org purge silently erase a "childless" portal_groups
// row before Portal's own receipted purge step ever ran for it, defeating the
// RESTRICT contract every other FK into portal_groups relies on. Only the
// composite tenant FK may exist, and it must stay RESTRICT.
describe('portal_groups schema — properties foreign keys', () => {
  it('has exactly one foreign key into properties, the composite tenant RESTRICT', () => {
    const config = getTableConfig(portalGroups)
    expect(config.foreignKeys).toHaveLength(1)

    const [tenantFk] = config.foreignKeys
    expect(tenantFk.getName()).toBe('portal_groups_property_tenant_fk')
    expect(tenantFk.onDelete).toBe('restrict')

    const reference = tenantFk.reference()
    expect(reference.columns.map((column) => column.name)).toEqual([
      'organization_id',
      'property_id',
    ])
    expect(reference.foreignColumns.map((column) => column.name)).toEqual([
      'organization_id',
      'id',
    ])
  })
})
