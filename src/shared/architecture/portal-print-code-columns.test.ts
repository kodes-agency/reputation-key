// Only four modules read the print code hashes of `portal_tokens`.
//
// A print code finds a Portal on its own, and so does the keyed hash a lookup is
// made by (ADR 0069, Portal invariant 9). The two columns sit on `portal_tokens`
// because that table is not exported and not queried; this suite keeps it that
// way by naming who may touch them:
//
// - the page repository (`portal-publication.repository.ts`): resolves a print
//   code to its Portal;
// - the access-artifact repository: resolves a scan to its channel;
// - the Portal command store (and `portal-token-commands.ts`, split out of it):
//   writes both hashes with a new or replacement code;
// - the address repository: fills a missing hash when an address is revealed.
//
// Naming the columns is one way to read them; a whole-row `select()` from the
// table, or a write with a bare `.returning()`, is the other, because it brings
// every column into memory whether or not the caller maps it away. Both are refused outside the four. Test code and the
// in-memory twins are not production modules and are not walked.
//
// This reads source text, so it does not see an aliased import of the table or
// a raw `SELECT *`; those are caught in review, like any other new reader.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const ROOTS = ['src', 'services', 'scripts'] as const

const PORTAL_INFRASTRUCTURE = join('src', 'contexts', 'portal', 'infrastructure')
const READERS = [
  join(PORTAL_INFRASTRUCTURE, 'repositories', 'portal-publication.repository.ts'),
  join(PORTAL_INFRASTRUCTURE, 'repositories', 'portal-access-artifact.repository.ts'),
  join(PORTAL_INFRASTRUCTURE, 'portal-command-store.ts'),
  join(PORTAL_INFRASTRUCTURE, 'portal-token-commands.ts'),
  join(PORTAL_INFRASTRUCTURE, 'repositories', 'portal-address.repository.ts'),
] as const

/** Where the columns are declared. */
const SCHEMA = join('src', 'shared', 'db', 'schema', 'portal.schema.ts')

const TEST_SUPPORT = [
  join('src', 'shared', 'testing') + '/',
  join('src', 'shared', 'db', 'testing') + '/',
] as const

const TEST_FILE = /\.(?:test|spec)\.tsx?$|\.stories\.tsx$/u

// The names, assembled from fragments so this file cannot match itself.
const COLUMN_NAME = new RegExp(
  ['\\b(?:qr|nfc)_print', '_code_hash\\b|\\b(?:qr|nfc)Print', 'CodeHash\\b'].join(''),
  'u',
)
const WHOLE_ROW_SELECT = new RegExp(
  ['\\.select(?:Distinct)?\\(\\s*\\)\\s*\\.from\\(\\s*portal', 'Tokens\\s*\\)'].join(''),
  'u',
)
// A write that returns everything (`.returning()` with no columns) reads the row
// back whole. The window is bounded so it stays inside one statement chain.
const WHOLE_ROW_RETURNING = new RegExp(
  [
    '\\.(?:insert|update|delete)\\(\\s*portal',
    'Tokens\\s*\\)[\\s\\S]{0,1500}?\\.returning\\(\\s*\\)',
  ].join(''),
  'u',
)
const WHOLE_ROW_TYPE = new RegExp(
  ['\\btypeof\\s+portal', 'Tokens\\.\\$infer', 'Select\\b'].join(''),
  'u',
)

const namesColumns = (source: string): boolean => COLUMN_NAME.test(source)
const readsWholeRow = (source: string): boolean =>
  WHOLE_ROW_SELECT.test(source) ||
  WHOLE_ROW_RETURNING.test(source) ||
  WHOLE_ROW_TYPE.test(source)

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue
      out.push(...walk(full))
      continue
    }
    if (/\.(ts|tsx|mjs)$/u.test(entry)) out.push(full)
  }
  return out
}

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '')

const isProductionSource = (file: string): boolean =>
  !TEST_FILE.test(file) && !TEST_SUPPORT.some((prefix) => file.startsWith(prefix))

const sources = ROOTS.flatMap((root) => walk(join(ROOT, root)))
  .map((full) => relative(ROOT, full))
  .filter(isProductionSource)
  .map((file) => ({
    file,
    source: stripComments(readFileSync(join(ROOT, file), 'utf8')),
  }))

const outsideTheReaders = sources.filter(
  ({ file }) => file !== SCHEMA && !(READERS as readonly string[]).includes(file),
)

describe('Portal print code hash columns', () => {
  it('walks a tree that contains the readers and the schema', () => {
    // A broken walk would make every assertion below vacuously pass.
    expect(sources.length).toBeGreaterThan(500)
    const files = sources.map(({ file }) => file)
    for (const reader of READERS) expect(files, reader).toContain(reader)
    expect(files).toContain(SCHEMA)
  })

  it('keeps the schema as the one place that declares the columns', () => {
    const schema = sources.find(({ file }) => file === SCHEMA)
    expect(schema && namesColumns(schema.source)).toBe(true)
  })

  it('names the hash columns only in the schema and the four readers', () => {
    expect(
      outsideTheReaders
        .filter(({ source }) => namesColumns(source))
        .map(({ file }) => file),
    ).toEqual([])
  })

  it('reads portal_tokens a whole row at a time only in the readers', () => {
    expect(
      outsideTheReaders
        .filter(({ source }) => readsWholeRow(source))
        .map(({ file }) => file),
    ).toEqual([])
  })

  it('knows the shapes it polices', () => {
    const qr = ['qr', 'Print', 'CodeHash'].join('')
    const nfc = ['nfc', '_print', '_code_hash'].join('')
    expect(namesColumns(`row.${qr}`)).toBe(true)
    expect(namesColumns(`SELECT ${nfc} FROM x`)).toBe(true)
    expect(namesColumns('row.tokenHash')).toBe(false)
    expect(namesColumns('printCodeHash')).toBe(false)

    const table = ['portal', 'Tokens'].join('')
    expect(readsWholeRow(`db.select().from(${table})`)).toBe(true)
    expect(readsWholeRow(`db\n  .selectDistinct()\n  .from( ${table} )`)).toBe(true)
    expect(readsWholeRow(`row: typeof ${table}.$inferSelect`)).toBe(true)
    expect(readsWholeRow(`db.select({ id: ${table}.id }).from(${table})`)).toBe(false)
    expect(readsWholeRow(`tx.insert(${table}).values(row)`)).toBe(false)
    expect(
      readsWholeRow(`tx\n  .update(${table})\n  .set({ status })\n  .returning()`),
    ).toBe(true)
    expect(readsWholeRow(`tx.insert(${table}).values(row).returning()`)).toBe(true)
    expect(
      readsWholeRow(`tx.update(${table}).set(x).returning({ id: ${table}.id })`),
    ).toBe(false)
    expect(readsWholeRow(`row: typeof ${table}.$inferInsert`)).toBe(false)
  })

  it('has every reader on disk, so a rename cannot silently widen the list', () => {
    for (const reader of READERS)
      expect(existsSync(join(ROOT, reader)), reader).toBe(true)
  })
})
