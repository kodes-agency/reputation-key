import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FORWARD_ONLY_CONSTRUCT_DEFINITIONS,
  MIGRATION_CREATED_CONSTRUCTS,
  SUPERSEDED_CONSTRUCT_DEFINITIONS,
  expectedConstructDefinitions,
  normalizeFunctionDefinition,
  normalizeTriggerDefinition,
  readConstructsFileDefinitions,
  readMigrationDefinitions,
  type ConstructDefinition,
} from './construct-sql.test-fixtures'
import { readMigrationJournal } from './migration-journal-order'
import { DB_ONLY_CONSTRUCTS } from './schema/db-only-constructs'
import { withoutForwardOnlyConstructs } from './construct-baseline-parity.test-fixtures'

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

  it('keeps the historical baseline unchanged except the named forward-only definitions', () => {
    const read = (path: string) =>
      readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
    expect(
      withoutForwardOnlyConstructs(read('drizzle/0001_db_constructs.sql')) ===
        withoutForwardOnlyConstructs(read('src/shared/db/db-constructs.sql')),
    ).toBe(true)
    for (const name of FORWARD_ONLY_CONSTRUCT_DEFINITIONS) {
      expect(
        [
          ...readMigrationDefinitions('0084_merchant_ai_consent_follows_notice'),
          ...readMigrationDefinitions('0088_reply_drafting_v2_release'),
          ...readMigrationDefinitions('0100_merchant_ai_notice_retention_corrections'),
        ]
          .reverse()
          .find((entry) => entry.name === name)?.definition,
      ).toBe(
        readConstructsFileDefinitions().find((entry) => entry.name === name)?.definition,
      )
    }
  })

  it('preserves whitespace outside the forward-only exception', () => {
    const changed = FILE_FUNCTION.replace('two  spaces', 'two spaces')
    expect(withoutForwardOnlyConstructs(FILE_FUNCTION)).toBe(FILE_FUNCTION)
    expect(withoutForwardOnlyConstructs(changed)).not.toBe(
      withoutForwardOnlyConstructs(FILE_FUNCTION),
    )
  })

  it('states one definition for every function and trigger the register names', () => {
    const stated = readConstructsFileDefinitions().map(keyOf)
    const registered = DB_ONLY_CONSTRUCTS.filter(
      ({ kind }) => kind === 'function' || kind === 'trigger',
    ).map(keyOf)

    const migrationCreated = MIGRATION_CREATED_CONSTRUCTS.map(keyOf)

    // The register is parsed from the same file by its own, simpler pattern: a
    // statement this parser swallowed or split would show as a difference. The
    // constructs only a migration creates are registered by hand and named in
    // MIGRATION_CREATED_CONSTRUCTS.
    expect(registered.length).toBeGreaterThan(100)
    expect([...stated, ...migrationCreated].sort()).toEqual([...registered].sort())
  })

  it('states every construct only a migration creates in that migration, and not in the file', () => {
    const stated = new Set(readConstructsFileDefinitions().map(keyOf))

    for (const entry of MIGRATION_CREATED_CONSTRUCTS) {
      expect(stated.has(keyOf(entry))).toBe(false)
      expect(
        readMigrationDefinitions(entry.migration).map(keyOf),
        `${entry.migration} creates ${keyOf(entry)}`,
      ).toContain(keyOf(entry))
    }
  })

  it('expects the migration text for a construct only a migration creates', () => {
    const expected = new Map(
      expectedConstructDefinitions().map((definition) => [keyOf(definition), definition]),
    )

    for (const entry of MIGRATION_CREATED_CONSTRUCTS) {
      expect(expected.get(keyOf(entry))?.source).toBe(`drizzle/${entry.migration}.sql`)
    }
  })

  it('guards the exclusion table with a before-delete-or-update row trigger', () => {
    const [guard] = readMigrationDefinitions(
      '0069_inbox_response_target_exclusions',
    ).filter(({ kind }) => kind === 'trigger')

    expect(guard?.definition).toBe(
      'CREATE TRIGGER inbox_response_target_exclusions_append_only_guard BEFORE DELETE OR UPDATE ON inbox_response_target_exclusions FOR EACH ROW EXECUTE FUNCTION enforce_inbox_response_target_exclusion_append_only_v1()',
    )
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
      // The last statement in the migration, as the comparator takes it.
      const inMigration = readMigrationDefinitions(entry.migration)
        .filter((definition) => keyOf(definition) === keyOf(entry))
        .at(-1)
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
