// Migration verification test — semantic schema authority gate.
//
// Two layers:
//   1. Presence assertions (PRE17A A1 heritage): the objects CI's
//      "empty → latest" migration path must produce.
//   2. Semantic parity (BQC-5.4): the full Drizzle model (including the
//      better-auth mirror) compared against the migrated PostgreSQL catalog —
//      columns/types/nullability/defaults, PK/unique/check/FK constraints incl.
//      actions, indexes incl. order/direction/expressions/predicates, enum
//      labels, journal continuity, and the DB-only register (both directions
//      closed). See ./CONTEXT.md and ./schema-drift.ts.
//
// In CI this runs after `auth:migrate && db:migrate` + the registered deploy
// sidecar against a fresh database. Locally it requires a migrated test
// database with the sidecar applied (see src/shared/db/CONTEXT.md).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { collectSchemaDrift, formatDrifts } from './schema-drift'

const EXPECTED_TABLES = [
  // Auth tables (created by auth:migrate)
  'user',
  'session',
  'account',
  'verification',
  'organization',
  'member',
  'invitation',
  // Business tables (created by db:migrate)
  'properties',
  'property_operation_receipts',
  'permission_version',
  'organization_role_policy',
  'teams',
  'staff_assignments',
  'audit_logs',
  'portals',
  'portal_groups',
  'portal_link_categories',
  'portal_links',
  'feedback',
  'ratings',
  'scan_events',
  'google_connections',
  'gbp_import_requests',
  'gbp_import_request_items',
  'gbp_import_item_retry_receipts',
  'property_operation_receipts',
  'replies',
  'inbox_items',
  'inbox_notes',
  'inbox_user_views',
  'metric_definitions',
  'metric_readings',
  // Migrations 0046-0054 (AI private-beta control plane and read models)
  'review_ai_analysis_heads',
  'ai_governance_policies',
  'ai_runtime_capability_profiles',
  'ai_provider_deployment_capabilities',
  'ai_read_barrier_heads',
  'ai_review_event_cursors',
  'ai_review_analysis_outcomes',
  'ai_execution_control_heads',
  'ai_execution_control_transitions',
  'ai_canary_authorization_heads',
  'ai_canary_authorizations',
  'ai_execution_permits',
  'ai_execution_permit_settlements',
  'ai_operation_profiles',
  'ai_provider_deployment_profiles',
  'ai_property_calendar_authorities',
  'ai_property_processing_profiles',
  'ai_routing_policies',
  'ai_operations',
  'ai_operation_attempts',
  'ai_review_analyses',
  'ai_property_aggregate_heads',
  'ai_property_daily_aggregates',
  'ai_property_trend_scheduler_heads',
  'ai_property_trend_schedules',
  'ai_property_trend_outcomes',
  'ai_property_aggregate_contributions',
  // Migration 0007 (BQR-1.1)
  'review_sync_state',
  'review_sync_runs',
  'inbound_webhook_receipts',
  'badge_definitions',
  'organization_badge_enablements',
  'badge_awards',
  'leaderboard_snapshots',
  'leaderboard_entries',
  'goals',
  'activity_log',
  'notifications',
  'notification_email_queue',
  'notification_preferences',
] as const

const EXPECTED_ROLLUP_TABLES = [
  'rollup_daily_metrics',
  'rollup_weekly_metrics',
  'rollup_daily_inbox_metrics',
  '_rollup_watermarks',
] as const

const EXPECTED_INDEXES = [
  'properties_org_gbp_location_id_unique',
  'metric_readings_recorded_at_idx',
  'inbox_items_source_date_idx',
  'properties_lifecycle_state_idx',
  'reviews_tenant_identity_unique',
  'ai_review_analyses_operation_unique',
  'ai_review_analyses_current_idx',
] as const

describe('migration verification (PRE17A A1 presence)', () => {
  let lease: TestLease

  beforeAll(async () => {
    const env = getEnv()
    lease = await acquireTestLease(env.DATABASE_URL)
  })

  afterAll(async () => {
    await lease?.release()
  })

  it('all expected tables exist', async () => {
    const result = await lease.pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
    const existing = new Set(result.rows.map((r) => r.tablename))

    const missing = EXPECTED_TABLES.filter((t) => !existing.has(t))
    expect(missing, `Missing tables: ${missing.join(', ')}`).toEqual([])
  })

  it('all expected rollup tables exist (migration 0008)', async () => {
    const result = await lease.pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
    const existing = new Set(result.rows.map((r) => r.tablename))

    const missing = EXPECTED_ROLLUP_TABLES.filter((t) => !existing.has(t))
    expect(missing, `Missing rollup tables: ${missing.join(', ')}`).toEqual([])
  })

  it('all expected indexes exist (migration 0004)', async () => {
    const result = await lease.pool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
    )
    const existing = new Set(result.rows.map((r) => r.indexname))

    const missing = EXPECTED_INDEXES.filter((i) => !existing.has(i))
    expect(missing, `Missing indexes: ${missing.join(', ')}`).toEqual([])
  })

  it('inbox_items has the correct status enum (open/closed, not old values)', async () => {
    const result = await lease.pool.query(
      `SELECT t.typname, e.enumlabel
       FROM pg_type t
       JOIN pg_enum e ON t.oid = e.enumtypid
       WHERE t.typname = 'inbox_status'
       ORDER BY e.enumsortorder`,
    )
    const labels = result.rows.map((r) => r.enumlabel)
    expect(labels).toContain('open')
    expect(labels).toContain('closed')
    expect(labels).not.toContain('new')
    expect(labels).not.toContain('read')
    expect(labels).not.toContain('addressed')
    expect(labels).not.toContain('archived')
    expect(labels).not.toContain('escalated')
  })

  it('inbox_items has escalation columns (migration 0003)', async () => {
    const result = await lease.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'inbox_items'
       AND column_name IN ('is_escalated', 'escalated_by', 'escalation_resolved_at', 'escalation_resolved_by', 'closed_at')`,
    )
    const columns = new Set(result.rows.map((r) => r.column_name))
    expect(columns.has('is_escalated')).toBe(true)
    expect(columns.has('escalated_by')).toBe(true)
    expect(columns.has('escalation_resolved_at')).toBe(true)
    expect(columns.has('escalation_resolved_by')).toBe(true)
    expect(columns.has('closed_at')).toBe(true)
  })

  it('inbox_user_views table exists (migration 0003)', async () => {
    const result = await lease.pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'inbox_user_views'`,
    )
    expect(result.rowCount).toBe(1)
  })

  it('no unjournaled sidecar SQL remains — all objects tracked by migrations', async () => {
    // The sidecar script is now migration 0004. Materialized views were
    // replaced by incremental rollup tables in migration 0008 (PRE17C).
    const journalResult = await lease.pool.query(
      `SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash IS NOT NULL`,
    )
    expect(journalResult.rowCount).toBeGreaterThan(0)

    // Materialized views were dropped by migration 0008
    const mvResult = await lease.pool.query(
      `SELECT count(*)::int FROM pg_matviews WHERE schemaname = 'public' AND matviewname LIKE 'mv_%'`,
    )
    expect(mvResult.rows[0].count).toBe(0)

    // Rollup tables must exist (created by migration 0008)
    const rollupResult = await lease.pool.query(
      `SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'rollup_%'`,
    )
    expect(rollupResult.rows[0].count).toBeGreaterThanOrEqual(3)

    // Watermark table must exist
    const watermarkResult = await lease.pool.query(
      `SELECT count(*)::int FROM _rollup_watermarks`,
    )
    expect(watermarkResult.rows[0].count).toBe(3)
  })
})

describe('semantic schema parity (BQC-5.4)', () => {
  let lease: TestLease

  beforeAll(async () => {
    const env = getEnv()
    lease = await acquireTestLease(env.DATABASE_URL)
  })

  afterAll(async () => {
    await lease?.release()
  })

  it('drizzle model matches the migrated catalog exactly (both directions closed)', async () => {
    const drifts = await collectSchemaDrift(lease.pool)
    expect(
      drifts,
      `Schema drift detected (${drifts.length}):\n${formatDrifts(drifts)}\n\n` +
        'Fix the model in src/shared/db/schema/*.ts to match the migrated DB, ' +
        'or register intentional DB-only constructs in ' +
        'src/shared/db/schema/db-only-constructs.ts (see src/shared/db/CONTEXT.md).',
    ).toEqual([])
  })
})
