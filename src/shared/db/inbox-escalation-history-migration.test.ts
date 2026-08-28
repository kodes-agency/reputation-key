// IBX-01-T4 — escalation history migration contract.
//
// Escalation currently survives only as latest-value flags on inbox_items.
// This migration adds the append-only history WITHOUT touching those flags:
// the expand-only assertions below exist so a later edit cannot quietly turn
// the addition into a contraction of the still-read projection columns.

import { readFileSync } from 'node:fs'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { inboxEscalationHistory } from './schema/inbox.schema'

const migrationPath = 'drizzle/0169_inbox_escalation_history.sql'
const migration = readFileSync(migrationPath, 'utf8')

describe('Inbox escalation history migration', () => {
  it('registers exactly one journal step 0169 for the escalation history table', () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
      entries: Array<{ idx: number; version: string; when: number; tag: string }>
    }
    const steps = journal.entries.filter(({ idx }) => idx === 169)
    expect(steps).toEqual([
      {
        idx: 169,
        version: '7',
        when: 1790352000040,
        tag: '0169_inbox_escalation_history',
        breakpoints: true,
      },
    ])
    expect(getTableConfig(inboxEscalationHistory).name).toBe('inbox_escalation_history')
    expect(migration).toContain('CREATE TABLE "inbox_escalation_history"')
    expect(migration).toContain(
      'PRIMARY KEY("inbox_item_id","resulting_command_revision")',
    )
    expect(migration).toContain("\"kind\" IN ('escalated', 'resolved')")
  })

  it('is expand-only and performs no destructive ALTER against inbox_items', () => {
    expect(migration).not.toMatch(/DROP\s+COLUMN/iu)
    expect(migration).not.toMatch(/DROP\s+TABLE/iu)
    expect(migration).not.toMatch(/DROP\s+CONSTRAINT/iu)
    expect(migration).not.toMatch(/TRUNCATE\s+(?:TABLE\s+)?"?inbox_items"?/iu)
    // The only inbox_items reference is the read-only FK target plus the
    // cascade-carve-out lookup inside the immutability guard.
    const inboxItemStatements = migration
      .split('--> statement-breakpoint')
      .filter((statement) => /inbox_items/u.test(statement))
    for (const statement of inboxItemStatements) {
      expect(statement).not.toMatch(/ALTER\s+TABLE\s+"inbox_items"/iu)
      expect(statement).not.toMatch(/UPDATE\s+"?inbox_items"?\s+SET/iu)
      expect(statement).not.toMatch(/DELETE\s+FROM\s+(?:public\.)?"?inbox_items"?/iu)
    }
  })

  it('installs the UPDATE-rejecting trigger and TRUNCATE guard used by assignment history', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "reject_inbox_escalation_history_mutation_v1"',
    )
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON "inbox_escalation_history"\nFOR EACH ROW EXECUTE FUNCTION "reject_inbox_escalation_history_mutation_v1"()',
    )
    expect(migration).toContain(
      'BEFORE TRUNCATE ON "inbox_escalation_history"\nFOR EACH STATEMENT EXECUTE FUNCTION "reject_inbox_escalation_history_mutation_v1"()',
    )
    expect(migration).toContain(
      'ENABLE ALWAYS TRIGGER "inbox_escalation_history_immutable"',
    )
    expect(migration).toContain(
      'ENABLE ALWAYS TRIGGER "inbox_escalation_history_truncate_guard"',
    )
    expect(migration).toContain(
      'REVOKE UPDATE, DELETE, TRUNCATE ON "inbox_escalation_history" FROM PUBLIC',
    )
    expect(migration).toContain("ERRCODE = '55000'")
  })

  it('keeps escalation an independent dimension: no status and no permission column', () => {
    const columns = getTableConfig(inboxEscalationHistory).columns.map(
      (column) => column.name,
    )
    expect(columns).toEqual([
      'inbox_item_id',
      'resulting_command_revision',
      'organization_id',
      'property_id',
      'handling_cycle_number',
      'kind',
      'actor_user_id',
      'occurred_at',
      'created_at',
    ])
    expect(migration).not.toMatch(/"status"|"permission"|"assigned_to"/iu)
  })
})
