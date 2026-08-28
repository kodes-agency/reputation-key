import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { betaFeedbackTriageTransitions } from './schema/beta-feedback-triage.schema'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0165_beta_feedback_triage.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> }

describe('0165 content-free beta feedback triage authority', () => {
  it('journals the expand-only migration in the assigned slot', () => {
    expect(journal.entries).toContainEqual(
      expect.objectContaining({
        idx: 165,
        when: 1790352000036,
        tag: '0165_beta_feedback_triage',
      }),
    )
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)/iu)
  })

  it('retains classification evidence without report text or attachment bytes', () => {
    const prohibitedColumns = [
      'title',
      'message',
      'description',
      'report_text',
      'attachment_bytes',
      'screenshot',
      'replay',
      'email',
      'user_id',
      'organization_id',
    ]
    for (const column of prohibitedColumns) {
      expect(migration).not.toContain(`"${column}"`)
    }
    expect(migration).toContain("interval '30 days'")
    expect(migration).toContain('beta_feedback_triage_delivery_shape')
    expect(migration).toContain('beta_feedback_triage_classification_shape')
    expect(migration).toContain('beta_feedback_triage_security_owner_shape')
    expect(migration).toContain('beta_feedback_triage_resolution_shape')
  })

  it('preserves exact dedupe and revision evidence in immutable transition rows', () => {
    const transitionColumns = getTableConfig(betaFeedbackTriageTransitions).columns.map(
      (column) => column.name,
    )
    expect(transitionColumns).toContain('duplicate_of_reference')
    expect(migration).toContain('beta_feedback_triage_transition_classification_shape')
    expect(migration).toContain('beta_feedback_triage_transition_dedupe_shape')
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "beta_feedback_triage_transition_revision_unique"',
    )
    expect(migration).toContain(
      'CONSTRAINT "beta_feedback_triage_transitions_feedback_reference_beta_feedback_triage_reference_fk" FOREIGN KEY ("feedback_reference") REFERENCES "public"."beta_feedback_triage"("reference") ON DELETE restrict',
    )
    expect(migration).toContain(
      'CONSTRAINT "beta_feedback_triage_duplicate_reference_fk" FOREIGN KEY ("duplicate_of_reference") REFERENCES "public"."beta_feedback_triage"("reference") ON DELETE restrict',
    )
    expect(migration).toContain(
      'CONSTRAINT "beta_feedback_triage_transition_duplicate_reference_fk" FOREIGN KEY ("duplicate_of_reference") REFERENCES "public"."beta_feedback_triage"("reference") ON DELETE restrict',
    )
    expect(migration).toContain('BEFORE TRUNCATE ON "beta_feedback_triage_transitions"')
    expect(migration).toContain(
      'ENABLE ALWAYS TRIGGER "beta_feedback_triage_revision_guard"',
    )
    expect(migration).toContain(
      'ENABLE ALWAYS TRIGGER "beta_feedback_triage_transition_update_guard"',
    )
    expect(migration).toContain(
      'ENABLE ALWAYS TRIGGER "beta_feedback_triage_transition_truncate_guard"',
    )
  })
})
