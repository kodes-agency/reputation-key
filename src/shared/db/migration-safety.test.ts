import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assertOnlineConstraints, contractionRequirement } from './migration-safety'
import { journalConcurrentIndex } from './journal-concurrent-index'
import { readMigrationJournal } from './migration-journal-order'

describe('online migration safeguards', () => {
  it.each([
    'ALTER TABLE records ADD CHECK (value > 0);',
    'ALTER TABLE records ADD CONSTRAINT positive CHECK (value > 0);',
    'ALTER TABLE records ADD COLUMN amount int CHECK (amount > 0);',
    'ALTER TABLE records ADD CHECK (value > 0), ADD CHECK (value < 10) NOT VALID;',
    "ALTER TABLE records ADD CHECK (value <> 'NOT VALID');",
    'ALTER TABLE records ADD CHECK (value > 0) /* NOT VALID */;',
    'DO $$ BEGIN ALTER TABLE records ADD CHECK (value > 0); END $$;',
    "DO $$ BEGIN EXECUTE 'ALTER TABLE records ADD CHECK (value > 0)'; END $$;",
    "DO $$ BEGIN EXECUTE E'ALTER TABLE records ADD CHECK (value > 0)'; END $$;",
    'ALTER TABLE records ADD CHECK (value > 0) /* outer /* nested */ NOT VALID */;',
  ])('rejects an immediate existing-table check: %s', (sql) => {
    expect(() => assertOnlineConstraints(sql)).toThrow('NOT VALID')
  })

  it.each([
    'ALTER TABLE records ADD FOREIGN KEY (parent_id) REFERENCES parents (id);',
    'ALTER TABLE records ADD CONSTRAINT parent_fk FOREIGN KEY (parent_id) REFERENCES parents (id);',
    'ALTER TABLE records ADD COLUMN parent_id int REFERENCES parents (id);',
    'ALTER TABLE records ADD FOREIGN KEY (parent_id, tenant_id) REFERENCES parents (id, tenant_id);',
    'ALTER TABLE records ADD FOREIGN KEY (parent_id) REFERENCES parents (id), ADD CHECK (value > 0) NOT VALID;',
    'ALTER TABLE records ADD CHECK (value > 0) NOT VALID, ADD FOREIGN KEY (parent_id) REFERENCES parents (id);',
    'ALTER TABLE records ADD FOREIGN KEY (parent_id) REFERENCES parents (id), ADD FOREIGN KEY (other_id) REFERENCES parents (id) NOT VALID;',
    'ALTER TABLE records ADD FOREIGN KEY (parent_id) REFERENCES parents (id) /* NOT VALID */;',
    'DO $$ BEGIN ALTER TABLE records ADD FOREIGN KEY (parent_id) REFERENCES parents (id); END $$;',
    "DO $$ BEGIN EXECUTE 'ALTER TABLE records ADD FOREIGN KEY (parent_id) REFERENCES parents (id)'; END $$;",
  ])('rejects an immediate existing-table foreign key: %s', (sql) => {
    expect(() => assertOnlineConstraints(sql)).toThrow('NOT VALID')
  })

  it.each([
    'ALTER TABLE records ADD CONSTRAINT parent_fk FOREIGN KEY (parent_id) REFERENCES parents (id) NOT VALID; ALTER TABLE records VALIDATE CONSTRAINT parent_fk;',
    'ALTER TABLE records ADD CONSTRAINT parent_fk FOREIGN KEY (parent_id) REFERENCES parents (id) NOT VALID, VALIDATE CONSTRAINT parent_fk;',
    'ALTER TABLE records VALIDATE CONSTRAINT parent_fk; ALTER TABLE records ADD CONSTRAINT other_fk FOREIGN KEY (other_id) REFERENCES parents (id) NOT VALID;',
  ])('requires foreign-key addition and validation in separate files: %s', (sql) => {
    expect(() => assertOnlineConstraints(sql)).toThrow('separate file')
  })

  it.each([
    'ALTER TABLE records ADD FOREIGN KEY (parent_id) REFERENCES parents (id) NOT VALID;',
    'ALTER TABLE records ADD CONSTRAINT parent_fk FOREIGN KEY (parent_id) REFERENCES parents (id) NOT VALID;',
    'ALTER TABLE records ADD CHECK (value > 0) NOT VALID, ADD FOREIGN KEY (parent_id) REFERENCES parents (id) NOT VALID;',
    'ALTER TABLE records VALIDATE CONSTRAINT parent_fk;',
    'CREATE TABLE records (parent_id int REFERENCES parents (id));',
    'CREATE TABLE records (parent_id int, FOREIGN KEY (parent_id) REFERENCES parents (id));',
  ])('allows online foreign keys and foreign keys on new tables: %s', (sql) => {
    expect(() => assertOnlineConstraints(sql)).not.toThrow()
  })

  it('requires addition and validation to commit in separate files', () => {
    expect(() =>
      assertOnlineConstraints(
        'ALTER TABLE records ADD CHECK (value > 0) NOT VALID; ALTER TABLE records VALIDATE CONSTRAINT positive;',
      ),
    ).toThrow('separate file')
    expect(() =>
      assertOnlineConstraints(
        'ALTER TABLE records ADD CONSTRAINT positive CHECK (value > 0) NOT VALID;',
      ),
    ).not.toThrow()
    expect(() =>
      assertOnlineConstraints('ALTER TABLE records VALIDATE CONSTRAINT positive;'),
    ).not.toThrow()
  })

  it('allows inline checks on new tables', () => {
    expect(() =>
      assertOnlineConstraints('CREATE TABLE records (value int CHECK (value > 0));'),
    ).not.toThrow()
  })

  it('keeps immutable shipped history executable without exempting new SQL', () => {
    for (const entry of readMigrationJournal()) {
      const { tag } = entry
      const sql = readFileSync(
        new URL(`../../../drizzle/${tag}.sql`, import.meta.url),
        'utf8',
      )
      expect(() => assertOnlineConstraints(sql, entry), tag).not.toThrow()
      expect(() => contractionRequirement(sql, entry), tag).not.toThrow()
    }
  })

  it.each(['tag', 'when', 'sql', 'missing'])(
    'does not exempt legacy SQL when its %s differs from the original entry',
    (changed) => {
      const original = readMigrationJournal().find(
        ({ tag }) => tag === '0083_review_analysis_v3_switch_on',
      )!
      let sql = readFileSync(
        new URL(`../../../drizzle/${original.tag}.sql`, import.meta.url),
        'utf8',
      )
      const entry =
        changed === 'missing'
          ? undefined
          : {
              ...original,
              tag: changed === 'tag' ? 'copied_legacy' : original.tag,
              when: changed === 'when' ? original.when + 1 : original.when,
            }
      if (changed === 'sql') sql += '\n-- changed SQL\n'

      expect(() => assertOnlineConstraints(sql, entry)).toThrow('NOT VALID')
      expect(() => contractionRequirement(sql, entry)).toThrow('reader-removal commit')
    },
  )

  it.each([
    'DROP TABLE records',
    'DROP SCHEMA archive CASCADE;',
    'DROP SCHEMA IF EXISTS "archive" CASCADE;',
    'DROP MATERIALIZED VIEW IF EXISTS public.record_totals;',
    'ALTER TABLE records SET SCHEMA archive;',
    'ALTER TABLE IF EXISTS ONLY "public"."records" SET SCHEMA "archive";',
    'DO $$ BEGIN DROP SCHEMA archive CASCADE; END $$;',
    "DO $$ BEGIN EXECUTE 'DROP MATERIALIZED VIEW record_totals'; END $$;",
    'ALTER TABLE records DROP COLUMN value',
    'ALTER TABLE records DROP retired;',
    'ALTER TABLE records DROP IF EXISTS retired;',
    'ALTER TABLE records ALTER COLUMN value TYPE bigint',
    'ALTER TABLE records ALTER value TYPE bigint;',
    'ALTER TABLE records ALTER value SET DATA TYPE bigint;',
    'ALTER TABLE ONLY public.records ADD fresh int, DROP "retired";',
    'ALTER TABLE "records" ADD fresh numeric(10, 2), ALTER "value" TYPE bigint;',
    'ALTER TABLE IF EXISTS ONLY "archive"."records" * ADD fresh numeric(10, 2), ALTER COLUMN "value" SET DATA TYPE numeric(20, 4);',
    'ALTER TABLE records ADD fresh int; ALTER TABLE archive.records ALTER value TYPE bigint;',
    'ALTER TABLE records ALTER COLUMN value SET NOT NULL',
    'ALTER TABLE records ALTER COLUMN value DROP DEFAULT;',
    'ALTER TABLE records ALTER value DROP DEFAULT;',
    'ALTER TABLE records ALTER value DROP NOT NULL;',
    'DROP INDEX CONCURRENTLY unused_index;',
    'ALTER TABLE records ENABLE ROW LEVEL SECURITY;',
    'CREATE OR REPLACE VIEW record_values AS SELECT value FROM records;',
    'SELECT value FROM records;',
    'ALTER TABLE records ADD fresh int; SELECT value FROM records;',
    'ALTER TABLE records ADD fresh int DEFAULT random();',
    'ALTER TABLE records ADD fresh int NOT NULL;',
    'ALTER TABLE records ADD fresh int NOT NULL DEFAULT NULL;',
    'ALTER TABLE records ADD fresh int DEFAULT (NULL::int) NOT NULL;',
    'ALTER TABLE records ADD fresh custom_domain;',
    "ALTER TABLE records ADD fresh int DEFAULT 1 + nextval('ids');",
    'ALTER TABLE records ADD fresh serial;',
    'ALTER TABLE records ADD fresh int GENERATED ALWAYS AS IDENTITY;',
    'ALTER TABLE records ADD fresh int, ALTER value DROP DEFAULT;',
    'ALTER TABLE records ADD fresh int; ALTER TABLE records ENABLE ROW LEVEL SECURITY;',
    'ALTER TABLE IF EXISTS ONLY public.records * ADD fresh numeric(10, 2), ALTER value SET DEFAULT round(1.23, 1);',
    'CREATE TABLE records AS SELECT rewrite_existing_data();',
    'CREATE TABLE records (value int) INHERITS (existing_records);',
    'CREATE INDEX records_idx ON records (value);',
    'CREATE UNIQUE INDEX CONCURRENTLY "records_idx" ON "records" ("value");',
    'CREATE INDEX CONCURRENTLY records_idx ON records (value) WHERE unsupported_predicate();',
    'CREATE TABLE records (value int) UNSUPPORTED OPTION;',
    'ALTER TABLE records ADD fresh int UNSUPPORTED OPTION;',
    'ALTER TABLE records ADD CONSTRAINT positive CHECK (value > 0) NOT VALID UNSUPPORTED OPTION;',
    'ALTER TABLE records VALIDATE CONSTRAINT positive UNSUPPORTED OPTION;',
    'CREATE INDEX CONCURRENTLY records_idx ON records (value) UNSUPPORTED OPTION;',
    'ALTER TABLE records ADD fresh int--> statement-breakpointALTER TABLE records ALTER value DROP DEFAULT;',
    "DO $$ BEGIN EXECUTE 'ALTER TABLE records ADD fresh int'; END $$;",
    'UNKNOWN MIGRATION STATEMENT;',
  ])('requires reader-removal evidence for %s', (sql) => {
    expect(() => contractionRequirement(sql)).toThrow('reader-removal commit')
  })

  it.each([
    'CREATE TABLE records (value int NOT NULL DEFAULT 1);',
    'CREATE TABLE IF NOT EXISTS public.records (value int, CHECK (value > 0));',
    'ALTER TABLE records ADD fresh numeric(10, 2);',
    'ALTER TABLE IF EXISTS ONLY public.records * ADD fresh numeric(10, 2), ADD COLUMN other text;',
    'ALTER TABLE records ADD COLUMN fresh int NOT NULL DEFAULT 7;',
    'ALTER TABLE records ADD COLUMN fresh int DEFAULT -7 NOT NULL;',
    "ALTER TABLE records ADD COLUMN fresh text DEFAULT 'DROP DEFAULT; NOT NULL';",
    'ALTER TABLE records ADD COLUMN fresh boolean NOT NULL DEFAULT false;',
    'ALTER TABLE records ADD COLUMN fresh text DEFAULT NULL;',
    'ALTER TABLE records ADD COLUMN fresh numeric(10, 2) DEFAULT (1.25::numeric) NOT NULL;',
    'ALTER TABLE records ADD COLUMN IF NOT EXISTS "fresh; NOT NULL" text;',
    '/* before */ ALTER TABLE records /* table */ ADD fresh int /* nullable */;',
    'ALTER TABLE records ADD fresh int; ALTER TABLE records ADD other text;',
    'ALTER TABLE records ADD fresh int--> statement-breakpointALTER TABLE records ADD other text;',
    'CREATE INDEX CONCURRENTLY records_idx ON records (value);',
    "CREATE INDEX CONCURRENTLY records_idx ON records (value) WHERE state = 'ready';",
    'CREATE INDEX CONCURRENTLY "records_idx" ON "records" ("value") WHERE (("state" = \'ready\'::text));',
    'ALTER TABLE records ADD CONSTRAINT positive CHECK (value > 0) NOT VALID;',
    'ALTER TABLE records ADD CONSTRAINT parent_fk FOREIGN KEY (parent_id) REFERENCES parents (id) NOT VALID;',
    'ALTER TABLE records VALIDATE CONSTRAINT positive;',
  ])('keeps compatible table changes as expands: %s', (sql) => {
    expect(contractionRequirement(sql)).toBeNull()
  })

  it.each([
    'double precision DEFAULT +1.25 NOT NULL',
    'character varying(20)',
    'character(20)',
    'timestamp with time zone',
    'time without time zone',
    'pg_catalog.numeric(10, 2)[][]',
    'int DEFAULT ((-1.25)::numeric(10, 2)) NOT NULL',
    "text DEFAULT ('ready')::pg_catalog.text NOT NULL",
  ])('accepts supported column types and constants: %s', (definition) => {
    expect(
      contractionRequirement(`ALTER TABLE records ADD fresh ${definition};`),
    ).toBeNull()
  })

  it.each([
    'double',
    'double text',
    'timestamp with zone',
    'time without time',
    'numeric()',
    'numeric(10,)',
    'numeric(10, 2, 3)',
    'numeric(ten)',
    'numeric(10, 2',
    'int[',
    'int DEFAULT +',
    'int DEFAULT 1.',
    'int DEFAULT .25',
    'int DEFAULT ()',
    'int DEFAULT (1',
    'int DEFAULT 1::custom_type',
    'int DEFAULT 1::numeric()',
    'int DEFAULT 1 + 2',
    'int,',
    'int)',
  ])('requires evidence for unsupported column syntax: %s', (definition) => {
    expect(() =>
      contractionRequirement(`ALTER TABLE records ADD fresh ${definition};`),
    ).toThrow('reader-removal commit')
  })

  it('returns evidence for an unrecognised statement only when explicitly declared', () => {
    const removalCommit = 'b'.repeat(40)
    expect(
      contractionRequirement(
        `-- migrate:contract ${removalCommit}\nUNKNOWN MIGRATION STATEMENT;`,
      ),
    ).toBe(removalCommit)
  })

  it('returns reader-removal evidence for a table contraction', () => {
    const removalCommit = 'a'.repeat(40)
    expect(
      contractionRequirement(
        `-- migrate:contract ${removalCommit}\nALTER TABLE records ADD fresh numeric(10, 2), ALTER value TYPE bigint;`,
      ),
    ).toBe(removalCommit)
  })

  it('does not permit other work in a nontransactional index file', () => {
    expect(() =>
      journalConcurrentIndex(
        '-- migrate:nontransactional\nCREATE INDEX CONCURRENTLY "idx" ON "records" ("value"); DELETE FROM records;',
      ),
    ).toThrow('one CREATE INDEX')
    expect(() =>
      journalConcurrentIndex('CREATE INDEX CONCURRENTLY "idx" ON "records" ("value");'),
    ).toThrow('nontransactional file')
  })
})
