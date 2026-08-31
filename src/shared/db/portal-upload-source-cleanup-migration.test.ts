import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0143_portal_upload_source_cleanup.sql'),
  'utf8',
)
const derivativeMigration = readFileSync(
  resolve(process.cwd(), 'drizzle/0144_portal_upload_orphan_derivative_cleanup.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; tag: string; when: number }> }

describe('0143 Portal private upload source cleanup', () => {
  it('adds an indexed, terminal-state-only deletion marker', () => {
    expect(migration).toContain('ADD COLUMN "source_deleted_at" timestamp with time zone')
    expect(migration).toContain('portal_upload_issuances_source_cleanup_idx')
    expect(migration).toContain('portal_upload_issuances_source_cleanup_valid')
    expect(migration).toContain(
      "\"state\" IN ('finalized', 'superseded', 'rejected', 'expired')",
    )
  })

  it('tracks idempotent cleanup of issuance-derived orphan derivatives', () => {
    expect(derivativeMigration).toContain(
      'ADD COLUMN "orphan_derivatives_deleted_at" timestamp with time zone',
    )
    expect(derivativeMigration).toContain(
      'portal_upload_issuances_orphan_derivative_cleanup_valid',
    )
    expect(derivativeMigration).toContain(
      "\"state\" IN ('superseded', 'rejected', 'expired')",
    )
  })

  it('owns the monotonic journal slot immediately after Guest network pressure', () => {
    const currentIndex = journal.entries.findIndex(
      (entry) => entry.tag === '0143_portal_upload_source_cleanup',
    )
    expect(currentIndex).toBeGreaterThan(0)
    expect(journal.entries[currentIndex - 1]).toMatchObject({
      idx: 142,
      tag: '0142_guest_network_pressure',
    })
    expect(journal.entries[currentIndex]).toMatchObject({ idx: 143 })
    expect(journal.entries[currentIndex].when).toBeGreaterThan(
      journal.entries[currentIndex - 1].when,
    )
    expect(journal.entries[currentIndex + 1]).toMatchObject({
      idx: 144,
      tag: '0144_portal_upload_orphan_derivative_cleanup',
    })
    expect(journal.entries[currentIndex + 1].when).toBeGreaterThan(
      journal.entries[currentIndex].when,
    )
  })
})
