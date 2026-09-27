import { describe, expect, it } from 'vitest'
import { CONCURRENT_INDEX_REGISTRY } from './concurrent-index-registry'
import { DB_ONLY_CONSTRUCTS } from './schema/db-only-constructs'

describe('concurrent index registry', () => {
  it('gives every entry a unique name', () => {
    const names = CONCURRENT_INDEX_REGISTRY.map((spec) => spec.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('never declares a build statement without CONCURRENTLY', () => {
    for (const spec of CONCURRENT_INDEX_REGISTRY) {
      expect(spec.createSql, spec.name).toContain('CREATE INDEX CONCURRENTLY')
    }
  })

  it('quotes the exact index name, table name and every column in build order', () => {
    for (const spec of CONCURRENT_INDEX_REGISTRY) {
      expect(spec.createSql, spec.name).toContain(`"${spec.name}"`)
      expect(spec.createSql, spec.name).toContain(`"${spec.table}"`)
      const columnsClause = spec.createSql.slice(spec.createSql.indexOf('('))
      let searchFrom = 0
      for (const column of spec.columns) {
        const quoted = `"${column}"`
        const foundAt = columnsClause.indexOf(quoted, searchFrom)
        expect(foundAt, `${spec.name} column ${column} in order`).toBeGreaterThanOrEqual(
          0,
        )
        searchFrom = foundAt + quoted.length
      }
    }
  })

  it('declares a WHERE clause exactly when hasPredicate says so', () => {
    for (const spec of CONCURRENT_INDEX_REGISTRY) {
      expect(spec.createSql.includes('WHERE'), spec.name).toBe(spec.hasPredicate)
    }
  })

  it('registers every entry as a DB-only construct with the matching kind', () => {
    for (const spec of CONCURRENT_INDEX_REGISTRY) {
      const registered = DB_ONLY_CONSTRUCTS.find(
        (construct) => construct.name === spec.name,
      )
      expect(registered, `${spec.name} registered in db-only-constructs.ts`).toBeDefined()
      expect(registered?.kind).toBe(spec.hasPredicate ? 'partial-index' : 'index')
    }
  })
})
