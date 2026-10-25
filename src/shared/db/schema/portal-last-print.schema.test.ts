import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  PRINT_FINAL_LOOKS,
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  PRINT_FINAL_PRINTERS,
} from '#/shared/domain/portal-print-final'
import { PRINT_FINAL_MAX_QUANTITY } from '#/shared/domain/portal-print-final-offer'
import {
  PRINT_KIT_CALLS_TO_ACTION,
  PRINT_KIT_PAPERS,
} from '#/shared/domain/portal-print-kit'
import {
  PORTAL_LAST_PRINT_CTA_SQL_LIST,
  PORTAL_LAST_PRINT_LOOK_SQL_LIST,
  PORTAL_LAST_PRINT_MAX_QUANTITY,
  PORTAL_LAST_PRINT_ORIENTATION_SQL_LIST,
  PORTAL_LAST_PRINT_PAPER_SQL_LIST,
  PORTAL_LAST_PRINT_PIECE_SQL_LIST,
  PORTAL_LAST_PRINT_PRINTER_SQL_LIST,
  portalLastPrints,
} from './portal-last-print.schema'

const valuesOf = (sqlList: string): string[] =>
  sqlList.split(', ').map((quoted) => quoted.replaceAll("'", ''))

describe('portal_last_prints schema', () => {
  it.each([
    ['pieces', PORTAL_LAST_PRINT_PIECE_SQL_LIST, PRINT_FINAL_PIECES],
    ['orientations', PORTAL_LAST_PRINT_ORIENTATION_SQL_LIST, PRINT_FINAL_ORIENTATIONS],
    ['looks', PORTAL_LAST_PRINT_LOOK_SQL_LIST, PRINT_FINAL_LOOKS],
    ['papers', PORTAL_LAST_PRINT_PAPER_SQL_LIST, PRINT_KIT_PAPERS],
    ['printers', PORTAL_LAST_PRINT_PRINTER_SQL_LIST, PRINT_FINAL_PRINTERS],
    ['calls to action', PORTAL_LAST_PRINT_CTA_SQL_LIST, PRINT_KIT_CALLS_TO_ACTION],
  ] as const)(
    'lists exactly the domain %s in its CHECK constraint',
    (_name, list, domain) => {
      expect(valuesOf(list)).toEqual([...domain])
    },
  )

  it('bounds the quantity as the download does', () => {
    expect(PORTAL_LAST_PRINT_MAX_QUANTITY).toBe(PRINT_FINAL_MAX_QUANTITY)
  })

  it('is one row per Portal, tied to its Portal by the tenant key and removed with it', () => {
    const config = getTableConfig(portalLastPrints)
    expect(config.primaryKeys).toHaveLength(0)
    expect(
      config.columns.filter((column) => column.primary).map((column) => column.name),
    ).toEqual(['portal_id'])
    expect(config.foreignKeys).toHaveLength(1)
    const [fk] = config.foreignKeys
    expect(fk?.getName()).toBe('portal_last_prints_portal_tenant_fk')
    expect(fk?.onDelete).toBe('cascade')
    expect(fk?.reference().columns.map((column) => column.name)).toEqual([
      'organization_id',
      'property_id',
      'portal_id',
    ])
  })

  it('has no column for an address, a print code or a file', () => {
    const names = getTableConfig(portalLastPrints).columns.map((column) => column.name)
    for (const name of names) {
      expect(name).not.toMatch(/address|token|code|url|pdf|file|hash|secret/u)
    }
  })
})
