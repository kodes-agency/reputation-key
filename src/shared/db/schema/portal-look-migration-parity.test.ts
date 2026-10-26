// Migration 0074 is hand-written SQL (drizzle/meta stops at 0013), so what it
// wrote is pinned here as literals and tied to the model: widening a mode or a
// rule later asks for a new migration instead of tempting anyone to edit 0074.
// What the SQL does against PostgreSQL is the portal-look repository's
// integration test; `pnpm check:schema-drift` proves the model matches a
// migrated database.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  PORTAL_LOOK_BACKGROUND_MODE_SQL_LIST,
  PORTAL_LOOK_GROUP_MODE_SQL_LIST,
  PORTAL_LOOK_PHOTO_MODE_SQL_LIST,
  portalLookOverrides,
} from './portal-look.schema'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MIGRATION = readFileSync(
  join(ROOT, 'drizzle', '0074_portal_look_overrides.sql'),
  'utf8',
)
const JOURNAL = JSON.parse(
  readFileSync(join(ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8'),
) as { entries: ReadonlyArray<{ idx: number; tag: string; when: number }> }

const STATEMENTS = MIGRATION.split('--> statement-breakpoint').map((part) =>
  part
    .split('\n')
    .filter((line) => !line.startsWith('--'))
    .join('\n')
    .trim(),
)

const config = getTableConfig(portalLookOverrides)
const dialect = new PgDialect()

describe('migration 0074 portal look overrides', () => {
  it('creates the one table with its indexes and keys, and changes nothing else', () => {
    expect(STATEMENTS).toHaveLength(6)
    expect(STATEMENTS[0]).toMatch(/^CREATE TABLE "portal_look_overrides" \(/u)
    for (const statement of STATEMENTS.slice(1)) {
      expect(statement).toMatch(
        /^(CREATE (UNIQUE )?INDEX|ALTER TABLE "portal_look_overrides")/u,
      )
    }
    // No row is written or removed, and no other table is altered.
    for (const statement of STATEMENTS) {
      expect(statement).not.toMatch(/^(?:UPDATE|DELETE|INSERT)\b/u)
    }
    expect(STATEMENTS.join('\n')).not.toMatch(/\bDROP\b/u)
  })

  it('tripwire: the vocabularies still render what 0074 wrote', () => {
    expect(PORTAL_LOOK_PHOTO_MODE_SQL_LIST).toBe(`'inherit', 'own', 'none'`)
    expect(PORTAL_LOOK_GROUP_MODE_SQL_LIST).toBe(`'inherit', 'own'`)
    expect(PORTAL_LOOK_BACKGROUND_MODE_SQL_LIST).toBe(`'auto', 'manual'`)
  })

  it('writes every CHECK of the model exactly as the model renders it', () => {
    expect(config.checks.length).toBeGreaterThan(0)
    for (const check of config.checks) {
      const rendered = dialect.sqlToQuery(check.value).sql
      expect(STATEMENTS[0], check.name).toContain(
        `CONSTRAINT "${check.name}" CHECK (${rendered})`,
      )
    }
    expect(STATEMENTS[0]?.match(/CONSTRAINT "/gu)).toHaveLength(config.checks.length)
  })

  it('declares every column of the model with its type, nullability and default', () => {
    for (const column of config.columns) {
      const line = STATEMENTS[0]
        ?.split('\n')
        .find((candidate) => candidate.trimStart().startsWith(`"${column.name}" `))
      expect(line, column.name).toBeDefined()
      expect(line).toContain(`"${column.name}" ${column.getSQLType()}`)
      expect(line?.includes('NOT NULL'), column.name).toBe(column.notNull)
      expect(line?.includes('DEFAULT'), column.name).toBe(column.hasDefault)
    }
  })

  it('keeps the own photo, its focal point and its descriptions together', () => {
    expect(MIGRATION).toContain('"hero_focal_x" double precision')
    expect(MIGRATION).toContain('"hero_focal_y" double precision')
    expect(MIGRATION).toContain(`"hero_alt_texts" jsonb DEFAULT '{}'::jsonb NOT NULL`)
  })

  it('is one row per Portal, found by Property for the Property look writers', () => {
    expect(STATEMENTS).toContain(
      'CREATE UNIQUE INDEX "portal_look_overrides_portal_unique" ON "portal_look_overrides" ' +
        'USING btree ("organization_id","portal_id");',
    )
    expect(STATEMENTS).toContain(
      'CREATE INDEX "portal_look_overrides_property_idx" ON "portal_look_overrides" ' +
        'USING btree ("organization_id","property_id");',
    )
    const indexes = config.indexes.map((index) => index.config)
    expect(indexes.map((index) => [index.name, index.unique])).toEqual([
      ['portal_look_overrides_portal_unique', true],
      ['portal_look_overrides_property_idx', false],
    ])
  })

  it('ties the row and both images to the same Organization and Property, RESTRICT', () => {
    const targets = {
      portal_look_overrides_portal_tenant_fk: [
        '("organization_id","property_id","portal_id")',
        '"public"."portals"("organization_id","property_id","id")',
      ],
      portal_look_overrides_hero_asset_fk: [
        '("organization_id","property_id","hero_asset_id")',
        '"public"."portal_media_assets"("organization_id","property_id","id")',
      ],
      portal_look_overrides_logo_asset_fk: [
        '("organization_id","property_id","logo_asset_id")',
        '"public"."portal_media_assets"("organization_id","property_id","id")',
      ],
    } as const
    for (const [name, [columns, target]] of Object.entries(targets)) {
      const statement = STATEMENTS.find((part) =>
        part.includes(`ADD CONSTRAINT "${name}"`),
      )
      expect(statement, name).toBeDefined()
      expect(statement).toContain(`FOREIGN KEY ${columns} REFERENCES ${target}`)
      expect(statement).toContain('ON DELETE restrict')
    }
    expect(config.foreignKeys.map((fk) => [fk.getName(), fk.onDelete]).sort()).toEqual(
      Object.keys(targets)
        .map((name) => [name, 'restrict'])
        .sort(),
    )
  })

  it('is journalled after 0073', () => {
    const entry = JOURNAL.entries.find((candidate) => candidate.idx === 74)
    expect(entry?.tag).toBe('0074_portal_look_overrides')
    const previous = JOURNAL.entries.find((candidate) => candidate.idx === 73)
    expect(previous?.tag).toBe('0073_portal_contact_destinations')
    expect(entry && previous && entry.when > previous.when).toBe(true)
  })
})
