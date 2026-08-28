import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  aiReviewAnalysisBackfillRunMemberships,
  aiReviewAnalysisEnrollmentMemberships,
  aiReviewAnalysisEnrollmentReplays,
  aiReviewAnalysisEnrollments,
} from './ai.schema'

const config = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table)

describe('Review Analysis first-enablement schema', () => {
  it('stores the exact authorization fence and separate snapshot/caught-up proofs', () => {
    const table = config(aiReviewAnalysisEnrollments)

    expect(table.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'authorization_lineage_id',
        'authorization_state_version',
        'source_epoch',
        'review_analysis_epoch',
        'analysis_start_sequence',
        'snapshot_revision_count',
        'snapshot_revision_set_digest',
        'snapshot_captured_at',
        'caught_up_eligible_revision_count',
        'caught_up_analysis_sequence',
        'caught_up_revision_set_digest',
        'caught_up_at',
      ]),
    )
    expect(table.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'ai_review_analysis_enrollments_fence_unique',
        'ai_review_analysis_enrollments_trigger_unique',
        'ai_review_analysis_enrollments_one_active',
        'ai_review_analysis_enrollments_actionable_idx',
      ]),
    )
    expect(table.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'ai_review_analysis_enrollments_snapshot_valid',
        'ai_review_analysis_enrollments_terminal_valid',
        'ai_review_analysis_enrollments_time_valid',
      ]),
    )
  })

  it('keeps immutable enrollment membership tenant-scoped and revision-pinned', () => {
    const membership = config(aiReviewAnalysisEnrollmentMemberships)
    const replay = config(aiReviewAnalysisEnrollmentReplays)

    expect(membership.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'enrollment_id',
        'organization_id',
        'property_id',
        'ordinal',
        'review_id',
        'source_epoch',
        'source_revision',
        'analysis_sequence',
      ]),
    )
    expect(membership.foreignKeys.map((key) => key.getName())).toContain(
      'ai_review_enrollment_memberships_scope_fk',
    )
    expect(replay.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'enrollment_id',
        'run_id',
        'organization_id',
        'property_id',
      ]),
    )
    expect(replay.foreignKeys.map((key) => key.getName())).toEqual(
      expect.arrayContaining([
        'ai_review_analysis_enrollment_replays_enrollment_fk',
        'ai_review_analysis_enrollment_replays_run_fk',
      ]),
    )
  })

  it('adds a nullable expand-phase revision pin to legacy backfill membership', () => {
    const table = config(aiReviewAnalysisBackfillRunMemberships)
    const revision = table.columns.find((column) => column.name === 'source_revision')

    expect(revision).toBeDefined()
    expect(revision?.notNull).toBe(false)
    expect(table.checks.map((constraint) => constraint.name)).toContain(
      'ai_review_backfill_memberships_revision_safe',
    )
  })
})
