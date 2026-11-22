import { expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { inboxSourceIdMatchesAny } from './inbox-list-narrowing.server'

it('binds large source-id sets as one PostgreSQL array parameter', () => {
  const ids = Array.from(
    { length: 70_000 },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  )

  const compiled = new PgDialect().sqlToQuery(inboxSourceIdMatchesAny(ids))
  const boundIds = compiled.params[0] as ReadonlyArray<string>

  expect(compiled.sql).toContain('= ANY($1::uuid[])')
  expect(compiled.params).toHaveLength(1)
  expect(boundIds).toHaveLength(ids.length)
  expect(boundIds[0]).toBe(ids[0])
  expect(boundIds.at(-1)).toBe(ids.at(-1))
})
