// db-constructs.sql is the authority for the DB-only functions and triggers, and
// drizzle/0001_db_constructs.sql is its byte copy; a later migration that
// changes one restates it there (docs/BETA.md §6). These cases hold the pure
// half of that rule: how a definition is read and compared, and — with no
// database — that the file states the definition the journal ends on for every
// construct a later migration creates. The catalog half is
// construct-definitions.integration.test.ts.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SUPERSEDED_CONSTRUCT_DEFINITIONS,
  compareConstructDefinitions,
  expectedConstructDefinitions,
  normalizeFunctionDefinition,
  normalizeTriggerDefinition,
  parseConstructDefinitions,
  readConstructsFileDefinitions,
  readMigrationDefinitions,
  type ConstructDefinition,
} from './construct-definitions'
import { readMigrationJournal } from './migration-journal-order'
import { DB_ONLY_CONSTRUCTS } from './schema/db-only-constructs'

const FILE_FUNCTION = `CREATE OR REPLACE FUNCTION public.count_rows(p_table text, p_limit integer DEFAULT 10)
 RETURNS public.row_summary
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- two  spaces and a trailing blank stay as written
  RETURN public.summarise(p_table);
END;
$function$
;`

/** The same function as `pg_get_functiondef` prints it under a narrower search_path. */
const CATALOG_FUNCTION = `CREATE OR REPLACE FUNCTION public.count_rows(p_table text, p_limit integer DEFAULT 10)
 RETURNS row_summary
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- two  spaces and a trailing blank stay as written
  RETURN public.summarise(p_table);
END;
$function$
`

const FILE_TRIGGER =
  'CREATE TRIGGER ledger_guard BEFORE DELETE OR TRUNCATE OR UPDATE ON public.ledger FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();'
const CATALOG_TRIGGER =
  'CREATE TRIGGER ledger_guard BEFORE DELETE OR UPDATE OR TRUNCATE ON public.ledger FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation()'

const fromFile = (sql: string) => parseConstructDefinitions(sql, 'file.sql')
const inDatabase = (
  kind: ConstructDefinition['kind'],
  name: string,
  statement: string,
): ConstructDefinition => ({
  kind,
  name,
  definition:
    kind === 'function'
      ? normalizeFunctionDefinition(statement)
      : normalizeTriggerDefinition(statement),
  source: 'db',
})

describe('construct definition normalization', () => {
  it('reads a function the same from the file and from the catalog', () => {
    expect(normalizeFunctionDefinition(FILE_FUNCTION)).toBe(
      normalizeFunctionDefinition(CATALOG_FUNCTION),
    )
    expect(normalizeFunctionDefinition(FILE_FUNCTION)).toBe(
      normalizeFunctionDefinition(
        FILE_FUNCTION.replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION'),
      ),
    )
  })

  it('reads a NULL default the same with and without the cast PostgreSQL prints', () => {
    const written = FILE_FUNCTION.replace(
      'p_limit integer DEFAULT 10',
      'p_limit integer DEFAULT 10, p_ceremony_id uuid DEFAULT NULL',
    )
    const printed = written.replace('uuid DEFAULT NULL', 'uuid DEFAULT NULL::uuid')

    expect(normalizeFunctionDefinition(written)).toBe(
      normalizeFunctionDefinition(printed),
    )
    expect(normalizeFunctionDefinition(written)).not.toBe(
      normalizeFunctionDefinition(written.replace('uuid DEFAULT NULL', 'uuid')),
    )
  })

  it('keeps the body verbatim, qualifiers and spacing included', () => {
    const normalized = normalizeFunctionDefinition(FILE_FUNCTION)

    expect(normalized.split('\n')[0]).toBe(
      'CREATE OR REPLACE FUNCTION count_rows(p_table text, p_limit integer DEFAULT 10) RETURNS row_summary LANGUAGE plpgsql SECURITY DEFINER',
    )
    expect(normalized).toContain(
      '  -- two  spaces and a trailing blank stay as written\n',
    )
    expect(normalized).toContain('RETURN public.summarise(p_table);')
    expect(normalized).not.toBe(
      normalizeFunctionDefinition(FILE_FUNCTION.replace('two  spaces', 'two spaces')),
    )
  })

  it('tells a changed signature and a changed attribute from the original', () => {
    const original = normalizeFunctionDefinition(FILE_FUNCTION)

    expect(
      normalizeFunctionDefinition(
        FILE_FUNCTION.replace(
          'p_limit integer DEFAULT 10',
          'p_limit integer DEFAULT 10, p_ceremony_id uuid DEFAULT NULL::uuid',
        ),
      ),
    ).not.toBe(original)
    expect(
      normalizeFunctionDefinition(FILE_FUNCTION.replace(' SECURITY DEFINER\n', '')),
    ).not.toBe(original)
  })

  it('reads a trigger the same whatever order its events are written in', () => {
    expect(normalizeTriggerDefinition(FILE_TRIGGER)).toBe(
      normalizeTriggerDefinition(CATALOG_TRIGGER),
    )
    expect(normalizeTriggerDefinition(FILE_TRIGGER)).toBe(
      'CREATE TRIGGER ledger_guard BEFORE DELETE OR TRUNCATE OR UPDATE ON ledger FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation()',
    )
  })

  it('tells a trigger with other events, timing or function from the original', () => {
    const original = normalizeTriggerDefinition(FILE_TRIGGER)

    for (const [from, to] of [
      ['DELETE OR TRUNCATE OR UPDATE', 'DELETE OR UPDATE'],
      ['BEFORE', 'AFTER'],
      ['reject_ledger_mutation()', 'allow_ledger_mutation()'],
      ['FOR EACH STATEMENT', 'FOR EACH ROW'],
    ] as const) {
      expect(normalizeTriggerDefinition(FILE_TRIGGER.replace(from, to))).not.toBe(
        original,
      )
    }
  })
})

describe('construct definition parsing and comparison', () => {
  const FILE = `-- a comment before the first statement
${FILE_FUNCTION}
--> statement-breakpoint
${FILE_TRIGGER}
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ledger_key ON ledger (id);
`

  it('finds every function and trigger statement of a SQL file', () => {
    expect(fromFile(FILE).map(({ kind, name, source }) => [kind, name, source])).toEqual([
      ['function', 'count_rows', 'file.sql'],
      ['trigger', 'ledger_guard', 'file.sql'],
    ])
  })

  it('reports nothing when the database holds what the file states', () => {
    expect(
      compareConstructDefinitions(fromFile(FILE), [
        inDatabase('function', 'count_rows', CATALOG_FUNCTION),
        inDatabase('trigger', 'ledger_guard', CATALOG_TRIGGER),
      ]),
    ).toEqual([])
  })

  it('reports a body the database runs and the file does not state', () => {
    const superseded = CATALOG_FUNCTION.replace(
      'RETURN public.summarise(p_table);',
      'RETURN public.summarise_v2(p_table);',
    )

    expect(
      compareConstructDefinitions(fromFile(FILE), [
        inDatabase('function', 'count_rows', superseded),
        inDatabase('trigger', 'ledger_guard', CATALOG_TRIGGER),
      ]),
    ).toEqual([
      {
        object: 'function count_rows',
        detail:
          'definition differs from file.sql at line 5: expected [  RETURN public.summarise(p_table);] vs db [  RETURN public.summarise_v2(p_table);]',
      },
    ])
  })

  it('reports a second overload beside the stated function', () => {
    const overload = CATALOG_FUNCTION.replace(', p_limit integer DEFAULT 10', '')

    expect(
      compareConstructDefinitions(fromFile(FILE), [
        inDatabase('function', 'count_rows', CATALOG_FUNCTION),
        inDatabase('function', 'count_rows', overload),
      ]),
    ).toEqual([
      {
        object: 'function count_rows',
        detail: '2 definition(s) in db vs 1 in file.sql',
      },
    ])
  })

  it('reports a trigger recreated with other events', () => {
    expect(
      compareConstructDefinitions(fromFile(FILE), [
        inDatabase(
          'trigger',
          'ledger_guard',
          CATALOG_TRIGGER.replace(' OR TRUNCATE', ''),
        ),
      ]),
    ).toEqual([
      {
        object: 'trigger ledger_guard',
        detail:
          'definition differs from file.sql at line 1: expected […ledger_guard BEFORE DELETE OR TRUNCATE OR UPDATE ON ledger FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation()] vs db […ledger_guard BEFORE DELETE OR UPDATE ON ledger FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation()]',
      },
    ])
  })

  it('points at the difference in a signature too long to print', () => {
    const padding = Array.from({ length: 30 }, (_, index) => `p_${index} text`).join(', ')
    const longer = (last: string) =>
      FILE_FUNCTION.replace('p_table text', `${padding}, ${last}`)

    expect(
      compareConstructDefinitions(fromFile(longer('p_request_hash text')), [
        inDatabase('function', 'count_rows', longer('p_ceremony_id uuid')),
      ]),
    ).toEqual([
      {
        object: 'function count_rows',
        detail:
          'definition differs from file.sql at line 1: expected […text, p_28 text, p_29 text, p_request_hash text, p_limit integer DEFAULT 10) RETURNS row_summary LANGUAGE plpgsql SECURI…] vs db […text, p_28 text, p_29 text, p_ceremony_id uuid, p_limit integer DEFAULT 10) RETURNS row_summary LANGUAGE plpgsql SECURIT…]',
      },
    ])
  })

  it('leaves a name on one side only to the register check', () => {
    expect(
      compareConstructDefinitions(fromFile(FILE), [
        inDatabase('function', 'unregistered_function', CATALOG_FUNCTION),
      ]),
    ).toEqual([])
  })
})

describe('the committed constructs file', () => {
  const keyOf = ({ kind, name }: Readonly<{ kind: string; name: string }>) =>
    `${kind} ${name}`

  /** The last definition a migration after 0001 gives each construct. */
  function journalEndState(): ReadonlyMap<string, ConstructDefinition> {
    const later = readMigrationJournal().filter(
      ({ tag }) => tag !== '0000_baseline' && tag !== '0001_db_constructs',
    )
    return new Map(
      later.flatMap(({ tag }) =>
        readMigrationDefinitions(tag).map((definition) => [
          keyOf(definition),
          definition,
        ]),
      ),
    )
  }

  it('is copied byte for byte into drizzle/0001_db_constructs.sql', () => {
    const read = (path: string) =>
      readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

    // Compared as a boolean: a mismatch would print both 3,600-line files.
    expect(
      read('drizzle/0001_db_constructs.sql') === read('src/shared/db/db-constructs.sql'),
    ).toBe(true)
  })

  it('states one definition for every function and trigger the register names', () => {
    const stated = readConstructsFileDefinitions().map(keyOf)
    const registered = DB_ONLY_CONSTRUCTS.filter(
      ({ kind }) => kind === 'function' || kind === 'trigger',
    ).map(keyOf)

    // The register is parsed from the same file by its own, simpler pattern: a
    // statement this parser swallowed or split would show as a difference.
    expect(registered.length).toBeGreaterThan(100)
    expect([...stated].sort()).toEqual([...registered].sort())
  })

  it('expects, for every construct a later migration creates, the definition the journal ends on', () => {
    const expected = new Map(
      expectedConstructDefinitions().map((definition) => [keyOf(definition), definition]),
    )
    const stale = [...journalEndState()].flatMap(([key, last]) =>
      expected.get(key)?.definition === last.definition
        ? []
        : [`${key}: ${expected.get(key)?.source} is not what ${last.source} creates`],
    )

    expect(journalEndState().size).toBeGreaterThan(0)
    expect(stale).toEqual([])
  })

  it('names as superseded only a definition the file still states wrongly', () => {
    const stated = new Map(
      readConstructsFileDefinitions().map((definition) => [
        keyOf(definition),
        definition,
      ]),
    )
    const settled = SUPERSEDED_CONSTRUCT_DEFINITIONS.filter((entry) => {
      const inMigration = readMigrationDefinitions(entry.migration).find(
        (definition) => keyOf(definition) === keyOf(entry),
      )
      return (
        inMigration === undefined ||
        inMigration.definition === stated.get(keyOf(entry))?.definition
      )
    })

    // An entry listed here is no longer superseded (the file was reconciled, or
    // the migration does not define it): delete it from the list.
    expect(settled).toEqual([])
  })
})
