import { describe, expect, it } from 'vitest'
import { compareChecks } from './schema-drift'
import { DB_ONLY_CONSTRUCTS } from './schema/db-only-constructs'

const CHECK_NAME = 'inbox_handling_cycles_manual_reopen_valid'

const model = {
  name: 'inbox_handling_cycles',
  isAuth: false,
  columns: [],
  primaryKey: [],
  uniques: [],
  foreignKeys: [],
  checks: [{ name: CHECK_NAME, expr: 'model expression' }],
  indexes: [],
}

const databaseCheck = {
  table: 'inbox_handling_cycles',
  name: CHECK_NAME,
  type: 'c' as const,
  definition: 'catalog expression not valid',
  columns: [],
  refTable: null,
  refColumns: [],
  onUpdate: null,
  onDelete: null,
}

describe('schema drift registered CHECK handling', () => {
  it('registers the intentional NOT VALID Inbox write fence', () => {
    expect(
      DB_ONLY_CONSTRUCTS.find((construct) => construct.name === CHECK_NAME),
    ).toMatchObject({
      kind: 'check',
      owner: 'inbox',
      source: 'drizzle/0129_inbox_governed_manual_reopen.sql',
    })
  })

  it('exempts only its expression mismatch, not database existence', () => {
    expect(compareChecks(model, [databaseCheck])).toEqual([])
    expect(compareChecks(model, [])).toEqual([
      {
        kind: 'missing-in-db',
        object: `check ${CHECK_NAME} on inbox_handling_cycles`,
        detail: 'declared in model, absent in db',
      },
    ])
  })
})
