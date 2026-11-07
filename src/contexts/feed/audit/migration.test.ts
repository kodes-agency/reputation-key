import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import {
  assertOnlineConstraints,
  contractionRequirement,
} from '#/shared/db/migration-safety'
import { journalConcurrentIndex } from '#/shared/db/journal-concurrent-index'

const migrationsFolder = new URL('../../../../drizzle/', import.meta.url).pathname
const journal = JSON.parse(
  readFileSync(
    new URL('../../../../drizzle/meta/_journal.json', import.meta.url),
    'utf8',
  ),
) as { entries: { tag: string; when: number }[] }
const migrations = readMigrationFiles({ migrationsFolder })

describe('audit storage migration preflight', () => {
  for (const [index, entry] of journal.entries.entries()) {
    if (!entry.tag.includes('audit_events')) continue

    it(`admits ${entry.tag} as an expansion through the production preflight`, () => {
      const sql = migrations[index]!.sql.join('--> statement-breakpoint')
      expect(() => assertOnlineConstraints(sql, entry)).not.toThrow()
      expect(contractionRequirement(sql, entry)).toBeNull()
      expect(() => journalConcurrentIndex(sql)).not.toThrow()
    })
  }
})
