import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { propertyIdInScope } from './property-scope'

const dialect = new PgDialect()

/** Render the predicate the way a repository embeds it, text and parameters. */
const render = (propertyIds: readonly string[] | null) =>
  dialect.sqlToQuery(
    sql`SELECT p.id FROM properties p WHERE p.organization_id = ${'org-1'} AND ${propertyIdInScope(
      sql`p.id`,
      propertyIds,
    )}`,
  )

const FIRST = '00000000-0000-4000-8000-000000000001'
const SECOND = '00000000-0000-4000-8000-000000000002'

describe('propertyIdInScope', () => {
  it('limits nothing for Organization-wide access', () => {
    expect(render(null)).toMatchObject({
      sql: 'SELECT p.id FROM properties p WHERE p.organization_id = $1 AND true',
      params: ['org-1'],
    })
  })

  it('matches no row for an empty grant set rather than every row', () => {
    expect(render([])).toMatchObject({
      sql: 'SELECT p.id FROM properties p WHERE p.organization_id = $1 AND false',
      params: ['org-1'],
    })
  })

  it('binds each granted id as a uuid parameter, never as SQL text', () => {
    expect(render([FIRST, SECOND])).toMatchObject({
      sql: 'SELECT p.id FROM properties p WHERE p.organization_id = $1 AND p.id IN ($2::uuid, $3::uuid)',
      params: ['org-1', FIRST, SECOND],
    })
  })

  it('scopes whichever column the statement names the Property id by', () => {
    const query = dialect.sqlToQuery(propertyIdInScope(sql`property.id`, [FIRST]))

    expect(query).toMatchObject({ sql: 'property.id IN ($1::uuid)', params: [FIRST] })
  })
})
