import { isTable } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as schema from '#/shared/db/schema'
import { DATA_FATE_AUTHORITY, dataFateKey } from './data-fate-authority'

// Every schema module, keyed by the file name the authority records.
const SCHEMA_MODULES = Object.fromEntries(
  Object.entries(
    import.meta.glob<Record<string, unknown>>(
      ['../db/schema/*.ts', '!../db/schema/*.test.ts'],
      {
        eager: true,
      },
    ),
  ).map(([path, module]) => [path.slice(path.lastIndexOf('/') + 1), module]),
)

function tableExports(module: Record<string, unknown> | undefined): readonly string[] {
  return Object.entries(module ?? {})
    .filter(([, value]) => isTable(value))
    .map(([name]) => name)
}

describe('data-fate authority', () => {
  it('records each table under the schema file that exports it', () => {
    const misfiled = DATA_FATE_AUTHORITY.filter(
      (row) => !tableExports(SCHEMA_MODULES[row.schemaFile]).includes(row.exportName),
    ).map((row) => dataFateKey(row.schemaFile, row.exportName))

    expect(misfiled).toEqual([])
  })

  it('reaches every table a schema file exports through the schema barrel', () => {
    const barrel = new Set(tableExports(schema))
    const unreachable = Object.entries(SCHEMA_MODULES).flatMap(([file, module]) =>
      tableExports(module)
        .filter((name) => !barrel.has(name))
        .map((name) => dataFateKey(file, name)),
    )

    expect(unreachable).toEqual([])
  })
})
