// Source inventory retained for concurrent-index and historical SQL parity tests.
// Runtime schema verification compares structure.sql with pg_dump output,
// including every function, trigger, index and constraint definition.

import { readFileSync } from 'node:fs'
import { CONCURRENT_INDEX_REGISTRY } from '../concurrent-index-registry'

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
 * CHECK constraints authored in migration SQL, one legacy table, and the
 * function and trigger a later migration created with their table.
 */
const UNPARSED_CONSTRUCTS: readonly DbOnlyConstruct[] = [
  { name: 'inbox_handling_cycles_manual_reopen_valid', kind: 'check' },
  { name: 'organization_role_org_role_lower_unique', kind: 'expression-index' },
  { name: 'pr_no_overlapping_responsibility_intervals', kind: 'index' },
  { name: 'pr_no_overlapping_primary_intervals', kind: 'index' },
  { name: 'pgm_no_overlapping_portal_intervals', kind: 'index' },
  { name: 'gpv_no_overlapping_effective_intervals', kind: 'index' },
  { name: 'gsa_no_overlapping_subject_metric_intervals', kind: 'index' },
  // Migration 0069: the append-only guard of inbox_response_target_exclusions.
  {
    name: 'enforce_inbox_response_target_exclusion_append_only_v1',
    kind: 'function',
  },
  { name: 'inbox_response_target_exclusions_append_only_guard', kind: 'trigger' },
]

function readConstructsSql(): string {
  // The path is a module-relative constant resolved from import.meta.url, not
  // input: there is no caller-supplied value anywhere in this module.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(CONSTRUCTS_SQL, 'utf8')
}

/**
 * Indexes built by the CONCURRENTLY autocommit sidecar
 * (`../concurrent-index-sidecar.ts`) instead of the transactional migrator —
 * derived from the sidecar's own registry, so extending that registry never
 * needs a second hand-maintained entry here.
 */
const CONCURRENT_INDEX_SIDECAR_CONSTRUCTS: readonly DbOnlyConstruct[] =
  CONCURRENT_INDEX_REGISTRY.map((spec) => ({
    name: spec.name,
    kind: spec.hasPredicate ? 'partial-index' : 'index',
  }))

export const DB_ONLY_CONSTRUCTS: readonly DbOnlyConstruct[] = Object.freeze([
  ...parse(readConstructsSql()),
  ...UNPARSED_CONSTRUCTS,
  ...CONCURRENT_INDEX_SIDECAR_CONSTRUCTS,
])
