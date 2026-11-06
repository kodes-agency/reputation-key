import type { ConcurrentIndexSpec } from './concurrent-index-registry'
import { migrationTokens } from './migration-safety'

/** Nontransactional files contain exactly one recoverable index build. */
export function journalConcurrentIndex(
  sql: string,
): (ConcurrentIndexSpec & { predicate: string | null }) | null {
  const nontransactional = /^-- migrate:nontransactional\s*$/m.test(sql)
  const tokens = migrationTokens(sql)
  const concurrent = tokens.includes('CONCURRENTLY')
  if (!nontransactional && !concurrent) return null
  if (!nontransactional)
    throw new Error('Concurrent indexes require a nontransactional file')
  const statement = sql
    .replace(/^--[^\n]*$/gm, '')
    .trim()
    .replace(/;\s*$/, '')
  const match =
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded committed DDL; only the supported single-index grammar is accepted
    /^CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+"([a-z_0-9]+)"\s+ON\s+"([a-z_0-9]+)"\s*\(([^)]+)\)(?:\s+WHERE\s+([\s\S]+))?$/i.exec(
      statement,
    )
  if (!match || migrationTokens(statement).includes(';')) {
    throw new Error('A nontransactional file must contain one CREATE INDEX CONCURRENTLY')
  }
  const columns = match[4]!.split(',').map((column) => column.trim())
  if (!columns.every((column) => /^"[a-z_0-9]+"$/i.test(column))) {
    throw new Error('Concurrent index recovery requires named columns')
  }
  return {
    name: match[2]!,
    table: match[3]!,
    unique: Boolean(match[1]),
    columns: columns.map((column) => column.slice(1, -1)),
    hasPredicate: Boolean(match[5]),
    predicate: match[5] ?? null,
    createSql: statement,
  }
}
