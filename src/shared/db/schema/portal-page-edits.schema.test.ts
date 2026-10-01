import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  PORTAL_PAGE_EDIT_KINDS,
  PORTAL_PAGE_EDIT_TEXT_MAX,
} from '#/contexts/portal/domain/portal-page-edit'
import {
  PORTAL_PAGE_EDIT_KIND_SQL_LIST,
  PAGE_EDIT_TEXT_COLUMN_MAX as SCHEMA_TEXT_MAX,
  portalPageEdits,
} from './portal-publication.schema'

describe('portal_page_edits schema', () => {
  it('lists exactly the domain kinds in its CHECK constraint', () => {
    const inList = PORTAL_PAGE_EDIT_KIND_SQL_LIST.split(', ').map((quoted) =>
      quoted.replaceAll("'", ''),
    )
    expect(inList).toEqual([...PORTAL_PAGE_EDIT_KINDS])
  })

  it('stores wording up to the same bound the domain clips to', () => {
    expect(SCHEMA_TEXT_MAX).toBe(PORTAL_PAGE_EDIT_TEXT_MAX)
    const config = getTableConfig(portalPageEdits)
    for (const name of ['previous_text', 'new_text']) {
      const column = config.columns.find((candidate) => candidate.name === name)
      expect(column?.notNull, name).toBe(false)
      expect(column?.getSQLType(), name).toBe(`varchar(${PORTAL_PAGE_EDIT_TEXT_MAX})`)
    }
  })

  it('has a tenant foreign key into its Property and one into its Portal, both RESTRICT', () => {
    const config = getTableConfig(portalPageEdits)
    const byName = new Map(
      config.foreignKeys.map((fk) => [
        fk.getName(),
        {
          onDelete: fk.onDelete,
          columns: fk.reference().columns.map((column) => column.name),
        },
      ]),
    )
    expect(byName.size).toBe(2)
    expect(byName.get('portal_page_edits_property_tenant_fk')).toEqual({
      onDelete: 'restrict',
      columns: ['organization_id', 'property_id'],
    })
    expect(byName.get('portal_page_edits_portal_tenant_fk')).toEqual({
      onDelete: 'restrict',
      columns: ['organization_id', 'property_id', 'portal_id'],
    })
    // A Property-wide row has no Portal, so only the Property key ties it down.
    const portalId = config.columns.find((column) => column.name === 'portal_id')
    expect(portalId?.notNull).toBe(false)
  })
})
