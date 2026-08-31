import { getTableName, isTable } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as compatibilitySchema from '#/shared/db/schema/google-import-compatibility.schema'
import { DATA_FATE_AUTHORITY } from '#/shared/governance/data-fate-authority'
import {
  LEGACY_GBP_COMPATIBILITY_TABLES,
  buildLegacyGbpCompatibilitySection,
} from './legacy-gbp-compatibility-inventory'

const EMPTY_ROWS = LEGACY_GBP_COMPATIBILITY_TABLES.map(({ tableName }) => ({
  tableName,
  rowCount: 0,
}))

describe('legacy Google import compatibility section', () => {
  it('pins each Drizzle export to the physical table it really maps to', () => {
    for (const table of LEGACY_GBP_COMPATIBILITY_TABLES) {
      const value = compatibilitySchema[
        table.drizzleExportName as keyof typeof compatibilitySchema
      ] as unknown
      expect(isTable(value), table.drizzleExportName).toBe(true)
      expect(
        getTableName(value as Parameters<typeof getTableName>[0]),
        table.drizzleExportName,
      ).toBe(table.tableName)
    }

    const byExport = new Map(
      LEGACY_GBP_COMPATIBILITY_TABLES.map(({ drizzleExportName, tableName }) => [
        drizzleExportName,
        tableName,
      ]),
    )
    expect(byExport.get('legacyGbpCache')).toBe('gbp_cache')
    expect(byExport.get('legacyGbpImportJobs')).toBe('gbp_import_jobs')
  })

  it('covers exactly the compatibility_read rows of its own schema file', () => {
    const authorityExports = DATA_FATE_AUTHORITY.filter(
      ({ schemaFile, disposition }) =>
        schemaFile === 'google-import-compatibility.schema.ts' &&
        disposition === 'compatibility_read',
    ).map(({ exportName }) => exportName)

    expect([...authorityExports].sort()).toEqual(
      LEGACY_GBP_COMPATIBILITY_TABLES.map(
        ({ drizzleExportName }) => drizzleExportName,
      ).sort(),
    )
    expect(
      LEGACY_GBP_COMPATIBILITY_TABLES.every(
        ({ authority, dataFateDisposition, replacedBy }) =>
          authority === 'GGL-01/CNV-01' &&
          dataFateDisposition === 'compatibility_read' &&
          replacedBy === 'google-import-v2.schema.ts',
      ),
    ).toBe(true)
  })

  it('builds a content-free, never-candidate section with a stable fingerprint', () => {
    const section = buildLegacyGbpCompatibilitySection({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS,
    })
    const moved = buildLegacyGbpCompatibilitySection({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS.map((row) =>
        row.tableName === 'gbp_cache' ? { ...row, rowCount: 5 } : row,
      ),
    })

    expect(section.schemaContractionCandidate).toBe(false)
    expect(moved.schemaContractionCandidate).toBe(false)
    expect(section.totalRows).toBe(0)
    expect(moved.totalRows).toBe(5)
    expect(section.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(moved.fingerprint).not.toBe(section.fingerprint)
    expect(JSON.stringify(section)).not.toMatch(/gbp_place_id|initiated_by|data_type/u)
  })

  it('requires one exact count per mirror', () => {
    expect(() =>
      buildLegacyGbpCompatibilitySection({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tableRows: EMPTY_ROWS.slice(1),
      }),
    ).toThrow('legacy_gbp_compatibility_table_mismatch')

    expect(() =>
      buildLegacyGbpCompatibilitySection({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tableRows: [
          ...EMPTY_ROWS,
          { tableName: 'legacy_import_control' as never, rowCount: 0 },
        ],
      }),
    ).toThrow('legacy_gbp_compatibility_table_mismatch')
  })
})
