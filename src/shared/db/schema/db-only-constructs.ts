// Register of intentional DB-only constructs.
//
// `../db-constructs.sql` is the authority for functions and triggers: it is the
// second migration, it is what creates them, and it is regenerated into
// `drizzle/0001_db_constructs.sql` by `pnpm db:baseline`. Listing those names a
// second time by hand is how the old 1,863-line register drifted, so they are
// PARSED from that file instead — one source, no copy to keep in sync.
//
// The remaining dozen entries cannot be parsed from it: they are btree_gist
// exclusion indexes, CHECK constraints and one legacy table that live in the
// migration SQL or on Better Auth-owned tables, where two migrators must not
// share DDL ownership. Those stay explicit.
//
// The drift test (../schema-drift.ts) enforces both directions:
//   - every entry here must EXIST in pg_catalog;
//   - every trigger/function in pg_catalog must appear here;
//   - entries here are exempt from model-vs-catalog comparison.

import { readFileSync } from 'node:fs'

export type DbOnlyConstructKind =
  | 'trigger'
  | 'function'
  | 'index'
  | 'expression-index'
  | 'partial-index'
  | 'check'
  | 'enum'
  | 'index-direction'
  | 'other'

export type DbOnlyConstruct = Readonly<{
  /** Exact object name as it appears in pg_catalog. */
  name: string
  kind: DbOnlyConstructKind
}>

const CONSTRUCTS_SQL = new URL('../db-constructs.sql', import.meta.url)

/** `CREATE OR REPLACE FUNCTION public.<name>(` / `CREATE TRIGGER <name>`. */
const FUNCTION_DEFINITION =
  /^CREATE OR REPLACE FUNCTION (?:public\.)?"?([A-Za-z0-9_]+)"?\s*\(/gmu
const TRIGGER_DEFINITION = /^CREATE (?:CONSTRAINT )?TRIGGER "?([A-Za-z0-9_]+)"?/gmu

function parse(sql: string): readonly DbOnlyConstruct[] {
  const named = (pattern: RegExp, kind: DbOnlyConstructKind): DbOnlyConstruct[] =>
    [...sql.matchAll(pattern)].map(([, name]) => ({ name: name as string, kind }))
  const parsed = [
    ...named(FUNCTION_DEFINITION, 'function'),
    ...named(TRIGGER_DEFINITION, 'trigger'),
  ]
  const seen = new Set<string>()
  return parsed.filter(({ name, kind }) => {
    const key = `${kind}:${name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Constructs the Drizzle model deliberately does not own and that
 * `db-constructs.sql` does not create either: btree_gist exclusion indexes and
 * CHECK constraints authored in migration SQL, plus one legacy table.
 */
const UNPARSED_CONSTRUCTS: readonly DbOnlyConstruct[] = [
  { name: 'inbox_handling_cycles_manual_reopen_valid', kind: 'check' },
  { name: 'google_connections_credential_home_pair_check', kind: 'check' },
  { name: 'google_connections_credential_home_value_check', kind: 'check' },
  { name: 'organization_role_org_role_lower_unique', kind: 'expression-index' },
  { name: 'pr_no_overlapping_responsibility_intervals', kind: 'index' },
  { name: 'pr_no_overlapping_primary_intervals', kind: 'index' },
  { name: 'pgm_no_overlapping_portal_intervals', kind: 'index' },
  { name: 'gpv_no_overlapping_effective_intervals', kind: 'index' },
  { name: 'gsa_no_overlapping_subject_metric_intervals', kind: 'index' },
]

function readConstructsSql(): string {
  // The path is a module-relative constant resolved from import.meta.url, not
  // input: there is no caller-supplied value anywhere in this module.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(CONSTRUCTS_SQL, 'utf8')
}

export const DB_ONLY_CONSTRUCTS: readonly DbOnlyConstruct[] = Object.freeze([
  ...parse(readConstructsSql()),
  ...UNPARSED_CONSTRUCTS,
])
