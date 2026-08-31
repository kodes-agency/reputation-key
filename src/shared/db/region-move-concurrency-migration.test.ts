import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const activeAuthorityMigration = readFileSync(
  resolve(process.cwd(), 'drizzle/0147_region_move_active_authority_cas.sql'),
  'utf8',
)
const revisionMigration = readFileSync(
  resolve(process.cwd(), 'drizzle/0148_region_move_state_revision_cas.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> }

describe('0147–0148 Property region-move concurrency migrations', () => {
  it('makes one non-terminal move the PostgreSQL authority per Property', () => {
    expect(activeAuthorityMigration).toContain(
      'CREATE UNIQUE INDEX "region_moves_one_active_per_property_idx"',
    )
    expect(activeAuthorityMigration).toContain('("property_id")')
    expect(activeAuthorityMigration).toContain(
      `WHERE "region_moves"."state" NOT IN ('completed', 'rolled_back')`,
    )
    expect(activeAuthorityMigration).not.toMatch(/\b(?:UPDATE|DELETE)\b/u)
  })

  it('adds a positive revision token without rewriting existing move state', () => {
    expect(revisionMigration).toContain(
      'ADD COLUMN "state_revision" integer DEFAULT 1 NOT NULL',
    )
    expect(revisionMigration).toContain(
      'CONSTRAINT "region_moves_state_revision_check" CHECK ("region_moves"."state_revision" > 0)',
    )
    expect(revisionMigration).not.toMatch(/\b(?:UPDATE|DELETE)\b/u)
  })

  it('owns two consecutive monotonic journal slots after Activity replay', () => {
    const previous = journal.entries.find(({ idx }) => idx === 146)
    const authority = journal.entries.find(({ idx }) => idx === 147)
    const revision = journal.entries.find(({ idx }) => idx === 148)

    expect(authority).toMatchObject({
      idx: 147,
      when: 1790352000018,
      tag: '0147_region_move_active_authority_cas',
    })
    expect(revision).toMatchObject({
      idx: 148,
      when: 1790352000019,
      tag: '0148_region_move_state_revision_cas',
    })
    expect(authority!.when).toBeGreaterThan(previous!.when)
    expect(revision!.when).toBeGreaterThan(authority!.when)
  })
})
