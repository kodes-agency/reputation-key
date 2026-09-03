import { getTableName, isTable } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as authSchema from './auth'
import * as schema from './index'
import * as migratableSchema from './migratable'

function tableNames(values: Record<string, unknown>): ReadonlySet<string> {
  const names = new Set<string>()
  for (const value of Object.values(values)) {
    if (isTable(value)) names.add(getTableName(value))
  }
  return names
}

describe('migratable schema barrel', () => {
  it('exports every application table and no Better Auth table', () => {
    const authTables = tableNames(authSchema)
    const expected = [...tableNames(schema)]
      .filter((name) => !authTables.has(name))
      .sort()
    const actual = [...tableNames(migratableSchema)].sort()

    expect(actual).toEqual(expected)
  })
})
