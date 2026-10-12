// Definitions of the DB-only functions and triggers, compared with the catalog.
//
// `./db-constructs.sql` is the authority for these objects and
// `drizzle/0001_db_constructs.sql` is its byte copy (docs/BETA.md §6). The drift
// check used to compare them with the catalog by NAME, so a body or signature
// that a later migration changed without restating it in the file was invisible:
// the file said one function, every database ran another, and the next edit
// started from text nothing executes. This module compares the DEFINITION.
//
// Both sides are PostgreSQL's own rendering. The file was extracted with
// `pg_get_functiondef` / `pg_get_triggerdef`, and the catalog is read with the
// same two functions, so a faithful file matches after trivial normalization: a
// function body is compared verbatim, its header with whitespace collapsed and
// the `public.` qualifier dropped, and a trigger with its events in one order.
// Text written any other way (`int` for `integer`, attributes after the body)
// reads as drift: state a new function or trigger the way PostgreSQL prints it.
//
// Consumed by ./schema-drift.ts. Shared/db may read its own SQL files.

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

/** A difference between two sets of definitions: the object and what differs. */
export type ConstructDefinitionFault = Readonly<{ object: string; detail: string }>

/** Minimal query contract — satisfied by pg Pool / PoolClient / Client. */
type Queryable = {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>
}

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

/**
 * Definitions `db-constructs.sql` states wrongly, each with the migration that
 * holds the one every database runs. The target is an empty list.
 *
 * `apply_merchant_ai_transition_v1`: migration 0006 changed the body and 0016
 * replaced the 26-argument signature with a 27-argument one (`p_ceremony_id`);
 * neither was restated in the file, which still carries the pre-0006 text. The
 * file and its byte copy 0001 cannot simply be brought up to 0016: 0016 creates
 * the function with a plain `CREATE FUNCTION`, so an empty database that
 * already got the 27-argument function from 0001 fails there ("already exists
 * with same argument types"). Reconciling therefore changes the rule in
 * docs/BETA.md §6 one way or the other, which is the owner's decision: either
 * 0016 also becomes `CREATE OR REPLACE FUNCTION` (a second edited migration and
 * a second expected journal line), or the file alone takes the live text and
 * 0001 stops being its byte copy for this one statement. Until then the drift
 * check expects 0016's statement, so the function cannot drift further unseen,
 * and DO NOT restate it from the file's text: that adds a second overload and
 * makes every 26-argument call ambiguous.
 * construct-definitions.test.ts fails as soon as an entry here is no longer
 * superseded, or a later migration redefines the function.
 */
export const SUPERSEDED_CONSTRUCT_DEFINITIONS: readonly SupersededConstructDefinition[] =
  [
    {
      kind: 'function',
      name: 'apply_merchant_ai_transition_v1',
      migration: '0016_merchant_ai_notice_v2_ceremony',
    },
  ]

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
 * states, except the named superseded ones, which come from their migration.
 */
export function expectedConstructDefinitions(): readonly ConstructDefinition[] {
  return readConstructsFileDefinitions().map(
    (stated) => supersedingDefinition(stated) ?? stated,
  )
}

// ─── Comparison ─────────────────────────────────────────────────────

const EXCERPT_LENGTH = 120
/** Characters shown before the first differing one, to place it. */
const EXCERPT_LEAD = 30

function keyOf({ kind, name }: ConstructDefinition): string {
  return `${kind} ${name}`
}

/** Definitions by `kind name`; a function with overloads has more than one. */
function byKey(
  definitions: readonly ConstructDefinition[],
): ReadonlyMap<string, readonly ConstructDefinition[]> {
  const grouped = new Map<string, ConstructDefinition[]>()
  for (const definition of definitions) {
    const key = keyOf(definition)
    grouped.set(key, [...(grouped.get(key) ?? []), definition])
  }
  return grouped
}

/** Length of the prefix two lines share. */
function sharedPrefix(left: string, right: string): number {
  let length = 0
  while (length < left.length && left[length] === right[length]) length += 1
  return length
}

/** A window of the line that starts just before `from`. */
function excerpt(line: string | undefined, from: number): string {
  if (line === undefined) return '(nothing)'
  const start = Math.max(0, from - EXCERPT_LEAD)
  const end = start + EXCERPT_LENGTH
  return `${start > 0 ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`
}

/** Line 1 of a function is its signature and attributes; the body follows. */
function firstDifference(expected: string, actual: string): string {
  const want = expected.split('\n')
  const have = actual.split('\n')
  const at = want.findIndex((line, index) => line !== have[index])
  const line = at === -1 ? want.length : at
  const from = sharedPrefix(want[line] ?? '', have[line] ?? '')
  return `line ${line + 1}: expected [${excerpt(want[line], from)}] vs db [${excerpt(have[line], from)}]`
}

function compareOne(
  key: string,
  expected: readonly ConstructDefinition[],
  actual: readonly ConstructDefinition[],
): readonly ConstructDefinitionFault[] {
  const source = expected[0]?.source ?? CONSTRUCTS_FILE
  if (expected.length !== actual.length) {
    return [
      {
        object: key,
        detail: `${actual.length} definition(s) in db vs ${expected.length} in ${source}`,
      },
    ]
  }
  const want = expected.map(({ definition }) => definition).sort()
  const have = actual.map(({ definition }) => definition).sort()
  return want.flatMap((definition, index) => {
    const found = have[index] ?? ''
    return definition === found
      ? []
      : [
          {
            object: key,
            detail: `definition differs from ${source} at ${firstDifference(definition, found)}`,
          },
        ]
  })
}

/**
 * Definitions that differ between what the files state and what a database
 * holds. A name on one side only is not reported here: the register check in
 * ./schema-drift.ts already reports a missing or unregistered object.
 */
export function compareConstructDefinitions(
  expected: readonly ConstructDefinition[],
  actual: readonly ConstructDefinition[],
): readonly ConstructDefinitionFault[] {
  const held = byKey(actual)
  return [...byKey(expected)].flatMap(([key, definitions]) => {
    const inDatabase = held.get(key)
    return inDatabase ? compareOne(key, definitions, inDatabase) : []
  })
}

// ─── Catalog ────────────────────────────────────────────────────────

// Extension-owned functions are not ours to define (btree_gist installs 188).
const FUNCTION_DEFINITIONS_SQL = `SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_depend d
      JOIN pg_extension e ON e.oid = d.refobjid
      WHERE d.classid = 'pg_proc'::regclass
        AND d.objid = p.oid
        AND d.deptype = 'e'
    )`

const TRIGGER_DEFINITIONS_SQL = `SELECT tgname AS name, pg_get_triggerdef(oid) AS definition
  FROM pg_trigger
  WHERE NOT tgisinternal`

async function fetchCatalogDefinitions(
  q: Queryable,
): Promise<readonly ConstructDefinition[]> {
  const functions = await q.query(FUNCTION_DEFINITIONS_SQL)
  const triggers = await q.query(TRIGGER_DEFINITIONS_SQL)
  return [
    ...functions.rows.map((row): ConstructDefinition => ({
      kind: 'function',
      name: String(row.name),
      definition: normalizeFunctionDefinition(String(row.definition)),
      source: 'db',
    })),
    ...triggers.rows.map((row): ConstructDefinition => ({
      kind: 'trigger',
      name: String(row.name),
      definition: normalizeTriggerDefinition(String(row.definition)),
      source: 'db',
    })),
  ]
}

/** Every function and trigger whose definition in the database is not the stated one. */
export async function collectConstructDefinitionFaults(
  q: Queryable,
): Promise<readonly ConstructDefinitionFault[]> {
  return compareConstructDefinitions(
    expectedConstructDefinitions(),
    await fetchCatalogDefinitions(q),
  )
}
