import { type SQL, sql } from 'drizzle-orm'
import { type AnyPgColumn, foreignKey, timestamp } from 'drizzle-orm/pg-core'
import { properties } from './property.schema'

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

/**
 * Every AI table carries its Property's tenant as a composite key to
 * `properties`, so a row can never name another Organization's Property, and
 * it goes when the Property does.
 */
export const propertyTenantForeignKey = (
  t: Readonly<{ organizationId: AnyPgColumn; propertyId: AnyPgColumn }>,
  name: string,
) =>
  foreignKey({
    columns: [t.organizationId, t.propertyId],
    foreignColumns: [properties.organizationId, properties.id],
    name,
  }).onDelete('cascade')

const CLOSED_VOCABULARY_ENTRY = /^[a-z][a-z0-9_]*$/

/**
 * The inside of an `IN (...)` list for a closed, code-owned vocabulary: `'a', 'b'`.
 * Only snake_case words pass, so no value can carry a quote into the statement.
 */
export function sqlStringList(values: readonly string[]): SQL {
  for (const value of values) {
    if (!CLOSED_VOCABULARY_ENTRY.test(value)) {
      throw new Error('a closed SQL vocabulary holds lowercase snake_case words only')
    }
  }
  return sql.raw(values.map((value) => `'${value}'`).join(', '))
}

/** A regular expression as a SQL string literal. The pattern must not hold a quote. */
export function sqlPatternLiteral(pattern: string): SQL {
  if (pattern.includes("'")) throw new Error('a SQL pattern literal holds no quote')
  return sql.raw(`'${pattern}'`)
}
