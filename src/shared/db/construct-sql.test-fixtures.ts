// SQL source readers used only by historical construct parity and parallel-safety tests.

import { readFileSync } from 'node:fs'

export type ConstructKind = 'function' | 'trigger'

export type ConstructDefinition = Readonly<{
  kind: ConstructKind
  name: string
  /** Normalized statement: see normalizeFunctionDefinition / normalizeTriggerDefinition. */
  definition: string
  /** Where the text came from, for the drift line. */
  source: string
}>

const CONSTRUCTS_FILE = 'src/shared/db/db-constructs.sql'
const CONSTRUCTS_SQL = new URL('./db-constructs.sql', import.meta.url)
const MIGRATIONS = new URL('../../../drizzle/', import.meta.url)

// ─── Normalization ──────────────────────────────────────────────────

const DOLLAR_QUOTE_OPEN = /\bAS (\$[A-Za-z0-9_]*\$)/u
const PUBLIC_QUALIFIER = /\bpublic\./gu
const WHITESPACE_RUN = /\s+/gu
// PostgreSQL prints a parameter's NULL default with the parameter's type.
const NULL_DEFAULT_CAST = /\bDEFAULT NULL::[^,)]+/gu
const TRIGGER_EVENTS =
  /^(CREATE (?:CONSTRAINT )?TRIGGER \S+ (?:BEFORE|AFTER|INSTEAD OF) )(.+?)( ON .*)$/u
const EVENT_SEPARATOR = ' OR '

function collapse(text: string): string {
  return text
    .replace(PUBLIC_QUALIFIER, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
    .replace(/ ?;$/u, '')
}

/**
 * One header line, then the body exactly as written. The header is everything
 * before the dollar-quoted body; `CREATE FUNCTION` and `CREATE OR REPLACE
 * FUNCTION` are the same definition, and so are `DEFAULT NULL` and the
 * `DEFAULT NULL::uuid` PostgreSQL prints for it.
 */
export function normalizeFunctionDefinition(statement: string): string {
  const open = DOLLAR_QUOTE_OPEN.exec(statement)
  const tag = open?.[1]
  if (!open || !tag) return collapse(statement)
  const bodyStart = open.index + open[0].length
  const bodyEnd = statement.indexOf(tag, bodyStart)
  const header = collapse(statement.slice(0, open.index))
    .replace(/^CREATE FUNCTION /u, 'CREATE OR REPLACE FUNCTION ')
    .replace(NULL_DEFAULT_CAST, 'DEFAULT NULL')
  const body = statement.slice(bodyStart, bodyEnd === -1 ? undefined : bodyEnd)
  return `${header}\n${body.replace(/\r\n/gu, '\n')}`
}

/** One line; `DELETE OR UPDATE` and `UPDATE OR DELETE` are the same trigger. */
export function normalizeTriggerDefinition(statement: string): string {
  const flat = collapse(statement)
  const parts = TRIGGER_EVENTS.exec(flat)
  if (!parts) return flat
  const [, timing = '', events = '', rest = ''] = parts
  return `${timing}${events.split(EVENT_SEPARATOR).sort().join(EVENT_SEPARATOR)}${rest}`
}

// ─── SQL files ──────────────────────────────────────────────────────

const FUNCTION_STATEMENT =
  /^CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?"?([A-Za-z0-9_]+)"?\s*\([\s\S]*?\bAS (\$[A-Za-z0-9_]*\$)[\s\S]*?\2/gmu
const TRIGGER_STATEMENT = /^CREATE (?:CONSTRAINT )?TRIGGER "?([A-Za-z0-9_]+)"?[^;]*/gmu

/** Every `CREATE FUNCTION` and `CREATE TRIGGER` statement of a SQL file. */
export function parseConstructDefinitions(
  sql: string,
  source: string,
): readonly ConstructDefinition[] {
  const functions = [...sql.matchAll(FUNCTION_STATEMENT)].map(
    ([statement, name = '']): ConstructDefinition => ({
      kind: 'function',
      name,
      definition: normalizeFunctionDefinition(statement),
      source,
    }),
  )
  const triggers = [...sql.matchAll(TRIGGER_STATEMENT)].map(
    ([statement, name = '']): ConstructDefinition => ({
      kind: 'trigger',
      name,
      definition: normalizeTriggerDefinition(statement),
      source,
    }),
  )
  return [...functions, ...triggers]
}

/** The functions and triggers `db-constructs.sql` states. */
export function readConstructsFileDefinitions(): readonly ConstructDefinition[] {
  // Module-relative constant resolved from import.meta.url, never input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return parseConstructDefinitions(readFileSync(CONSTRUCTS_SQL, 'utf8'), CONSTRUCTS_FILE)
}

/** The functions and triggers one journalled migration creates. */
export function readMigrationDefinitions(tag: string): readonly ConstructDefinition[] {
  // The tag is a committed journal tag or a constant of this module, never input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sql = readFileSync(new URL(`${tag}.sql`, MIGRATIONS), 'utf8')
  return parseConstructDefinitions(sql, `drizzle/${tag}.sql`)
}

export type SupersededConstructDefinition = Readonly<{
  kind: ConstructKind
  name: string
  /** The journalled migration whose statement every database ends on. */
  migration: string
}>

/** No known superseded definitions remain in the live construct file. */
export const SUPERSEDED_CONSTRUCT_DEFINITIONS: readonly SupersededConstructDefinition[] =
  []

/** Forward-only reconciliation (0084; the notice-change helper restated by 0088); 0001 remains immutable historical SQL. */
export const FORWARD_ONLY_CONSTRUCT_DEFINITIONS = [
  'apply_merchant_ai_transition_v1',
  'merchant_ai_notice_material_changes_v1',
] as const

export type MigrationCreatedConstruct = Readonly<{
  kind: ConstructKind
  name: string
  /** The journalled migration that creates it, and the only file that states it. */
  migration: string
}>

/**
 * Functions and triggers that belong to a table a migration after 0001 created.
 * `db-constructs.sql` is copied byte for byte into 0001, which runs before such
 * a table exists, so it cannot state them: the migration that creates the table
 * creates them too, `./schema/db-only-constructs.ts` registers their names, and
 * the drift check expects the migration's text for them.
 */
export const MIGRATION_CREATED_CONSTRUCTS: readonly MigrationCreatedConstruct[] = [
  {
    kind: 'function',
    name: 'enforce_inbox_response_target_exclusion_append_only_v1',
    migration: '0069_inbox_response_target_exclusions',
  },
  {
    kind: 'trigger',
    name: 'inbox_response_target_exclusions_append_only_guard',
    migration: '0069_inbox_response_target_exclusions',
  },
]

function migrationCreatedDefinitions(): readonly ConstructDefinition[] {
  return MIGRATION_CREATED_CONSTRUCTS.flatMap((entry) =>
    readMigrationDefinitions(entry.migration)
      .filter(({ kind, name }) => kind === entry.kind && name === entry.name)
      .slice(-1),
  )
}

function supersedingDefinition(
  stated: ConstructDefinition,
): ConstructDefinition | undefined {
  const entry = SUPERSEDED_CONSTRUCT_DEFINITIONS.find(
    ({ kind, name }) => kind === stated.kind && name === stated.name,
  )
  if (!entry) return undefined
  return readMigrationDefinitions(entry.migration)
    .filter(({ kind, name }) => kind === stated.kind && name === stated.name)
    .at(-1)
}

/**
 * What every migrated database must hold: the definitions `db-constructs.sql`
 * states, except the named superseded ones, which come from their migration,
 * and the constructs only a migration creates.
 */
export function expectedConstructDefinitions(): readonly ConstructDefinition[] {
  return [
    ...readConstructsFileDefinitions().map(
      (stated) => supersedingDefinition(stated) ?? stated,
    ),
    ...migrationCreatedDefinitions(),
  ]
}
