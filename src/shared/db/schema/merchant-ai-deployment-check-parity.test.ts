import { readFileSync } from 'node:fs'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  merchantAiConsentEvidence,
  merchantAiEnablement,
} from './merchant-ai-authorization.schema'

const migration = (name: string) =>
  readFileSync(new URL(`../../../../drizzle/${name}.sql`, import.meta.url), 'utf8')

describe('dark streaming deployment migration', () => {
  it.each([merchantAiConsentEvidence, merchantAiEnablement])(
    'admits the streaming deployment only at release',
    (table) => {
      const config = getTableConfig(table)
      const check = config.checks.find(
        (candidate) => candidate.name === `${config.name}_profile_valid`,
      )!
      const predicate = new PgDialect().sqlToQuery(check.value).sql
      expect(predicate).toContain('private-beta-global-v3')
      expect(migration('0088_reply_drafting_v2_release')).toContain(
        `ADD CONSTRAINT "${check.name}" CHECK (${predicate})`,
      )
    },
  )
  it('only seeds the new deployment control, leaving CHECK widenings to switch-on', () => {
    const sql = migration('0086_reply_drafting_progress')
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/u)
    expect(sql).toContain('INSERT INTO ai_execution_control_transitions')
    expect(sql).toContain('INSERT INTO ai_execution_control_heads')
    expect(sql).toContain('provider:private-beta-global-v3')
  })
})
