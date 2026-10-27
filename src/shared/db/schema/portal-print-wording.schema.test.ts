import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { PRINT_FINAL_CALLS_TO_ACTION } from '#/shared/domain/portal-print-final-copy'
import { PORTAL_LAST_PRINT_CTA_SQL_LIST } from './portal-last-print.schema'
import { portalPrintWordings } from './portal-print-wording.schema'

describe('portal_print_wordings schema', () => {
  it('says the same wording ids as the last print and the domain list', () => {
    const ids = PORTAL_LAST_PRINT_CTA_SQL_LIST.split(', ').map((quoted) =>
      quoted.replaceAll("'", ''),
    )
    expect(ids).toEqual([...PRINT_FINAL_CALLS_TO_ACTION])
    const checks = getTableConfig(portalPrintWordings).checks.map((check) => check.name)
    expect(checks).toEqual([
      'portal_print_wordings_call_to_action_valid',
      'portal_print_wordings_call_to_action_custom_valid',
    ])
  })

  it('is one row per Portal, tied to its Portal by the tenant key and removed with it', () => {
    const config = getTableConfig(portalPrintWordings)
    expect(
      config.columns.filter((column) => column.primary).map((column) => column.name),
    ).toEqual(['portal_id'])
    expect(config.foreignKeys).toHaveLength(1)
    const [fk] = config.foreignKeys
    expect(fk?.getName()).toBe('portal_print_wordings_portal_tenant_fk')
    expect(fk?.onDelete).toBe('cascade')
    expect(fk?.reference().columns.map((column) => column.name)).toEqual([
      'organization_id',
      'property_id',
      'portal_id',
    ])
  })

  it('holds a wording and words only: no address, file, or the person who saved it', () => {
    const names = getTableConfig(portalPrintWordings).columns.map((column) => column.name)
    expect(names).toEqual([
      'portal_id',
      'organization_id',
      'property_id',
      'call_to_action',
      'call_to_action_custom',
      'updated_at',
    ])
    for (const name of names) {
      expect(name).not.toMatch(/address|token|code|url|pdf|file|hash|secret|user/u)
      expect(name.endsWith('_by')).toBe(false)
    }
  })
})
