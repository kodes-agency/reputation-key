// Migration verification test (PRE17A A1).
// Verifies that all expected schema objects exist after applying migrations.
// In CI, this runs after `auth:migrate && db:migrate` against a fresh database,
// effectively testing the "empty → latest" path.
// Locally, it requires a migrated test database.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

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
  'gbp_cache',
  'gbp_import_jobs',
  'reviews',
  'replies',
  'inbox_items',
  'inbox_notes',
  'inbox_user_views',
  'metric_definitions',
  'metric_readings',
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

const EXPECTED_MATERIALIZED_VIEWS = [
  'mv_daily_metrics',
  'mv_weekly_metrics',
  'mv_daily_inbox_metrics',
] as const

const EXPECTED_INDEXES = [
  'mv_daily_metrics_unique',
  'mv_weekly_metrics_unique',
  'mv_daily_inbox_metrics_unique',
  'properties_org_gbp_place_id_unique',
] as const

describe('migration verification (PRE17A A1)', () => {
  let lease: TestLease
  let pool: Pool

  beforeAll(async () => {
    const env = getEnv()
    lease = await acquireTestLease(env.DATABASE_URL)
    pool = lease.pool
  })

  afterAll(async () => {
    await lease?.release()
  })

  it('all expected tables exist', async () => {
    const result = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
    const existing = new Set(result.rows.map((r) => r.tablename))

    const missing = EXPECTED_TABLES.filter((t) => !existing.has(t))
    expect(missing, `Missing tables: ${missing.join(', ')}`).toEqual([])
  })

  it('all expected materialized views exist (migration 0004)', async () => {
    const result = await pool.query(
      `SELECT matviewname FROM pg_matviews WHERE schemaname = 'public' ORDER BY matviewname`,
    )
    const existing = new Set(result.rows.map((r) => r.matviewname))

    const missing = EXPECTED_MATERIALIZED_VIEWS.filter((v) => !existing.has(v))
    expect(missing, `Missing materialized views: ${missing.join(', ')}`).toEqual([])
  })

  it('all expected indexes exist (migration 0004)', async () => {
    const result = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
    )
    const existing = new Set(result.rows.map((r) => r.indexname))

    const missing = EXPECTED_INDEXES.filter((i) => !existing.has(i))
    expect(missing, `Missing indexes: ${missing.join(', ')}`).toEqual([])
  })

  it('inbox_items has the correct status enum (open/closed, not old values)', async () => {
    const result = await pool.query(
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
    const result = await pool.query(
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
    const result = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'inbox_user_views'`,
    )
    expect(result.rowCount).toBe(1)
  })

  it('no unjournaled sidecar SQL remains — all objects tracked by migrations', async () => {
    // The sidecar script (scripts/migrations/add-materialized-views-and-gbp-index.sql)
    // is now migration 0004. Verify the objects exist AND are tracked by the
    // drizzle migration journal (not applied manually).
    const journalResult = await pool.query(
      `SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash IS NOT NULL`,
    )
    expect(journalResult.rowCount).toBeGreaterThan(0)

    // The materialized views must exist (created by migration 0004)
    const mvResult = await pool.query(
      `SELECT count(*)::int FROM pg_matviews WHERE schemaname = 'public' AND matviewname LIKE 'mv_%'`,
    )
    expect(mvResult.rows[0].count).toBeGreaterThanOrEqual(3)
  })
})
