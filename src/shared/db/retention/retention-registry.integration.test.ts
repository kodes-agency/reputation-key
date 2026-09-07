// LIF-01-T16 — report-only mode against a real database.
//
// The unit tests prove the registry REFUSES apply. This proves the report path
// is genuinely inert: against seeded, definitely-eligible rows it opens no
// retention_runs evidence row, deletes nothing and redacts nothing. A report
// that silently opened an evidence row would claim a run that never happened;
// a report that deleted would be an unapproved apply wearing a report's name.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { contractionCandidateTableNames } from '#/shared/governance/contraction-inventory-registry'
import { buildRetentionRegistryReport } from './report-retention-registry'
import {
  assertRetentionRegistryApplyAllowed,
  RETENTION_REGISTRY,
  retentionRegistryContractionViolations,
} from './retention-registry'

let lease: TestLease
let db: Database

const ORGANIZATION = `org-retreg-${randomUUID().slice(0, 8)}`
const PROPERTY_ID = randomUUID()
const PORTAL_ID = randomUUID()
const RESPONSE_ID = randomUUID()

/** Well past every horizon in the registry, so eligibility is unambiguous. */
const SUBMITTED_AT = new Date('2022-01-01T00:00:00.000Z')
const GENERATED_AT = new Date('2026-08-28T00:00:00.000Z')

async function seed(): Promise<void> {
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORGANIZATION}, 'Retention Registry', ${ORGANIZATION}, NOW())
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
    VALUES (${PROPERTY_ID}, ${ORGANIZATION}, 'Retention Property', ${ORGANIZATION}, 'UTC', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug, created_at, updated_at)
    VALUES (${PORTAL_ID}, ${ORGANIZATION}, ${PROPERTY_ID}, ${PROPERTY_ID}, 'Retention Portal', ${ORGANIZATION}, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO guest_responses
      (id, organization_id, property_id, portal_id, status, rating, submitted_at, retention_deadline, created_at, updated_at)
    VALUES (
      ${RESPONSE_ID}, ${ORGANIZATION}, ${PROPERTY_ID}, ${PORTAL_ID}, 'submitted', 4,
      ${SUBMITTED_AT}, ${SUBMITTED_AT}, NOW(), NOW()
    )
  `)
  await db.execute(sql`
    INSERT INTO guest_response_private_feedback
      (response_id, organization_id, property_id, portal_id, body, submitted_at, expires_at)
    VALUES (
      ${RESPONSE_ID}, ${ORGANIZATION}, ${PROPERTY_ID}, ${PORTAL_ID},
      'expired-by-design fixture', ${SUBMITTED_AT}, ${new Date(SUBMITTED_AT.getTime() + 1000)}
    )
  `)
}

async function cleanup(): Promise<void> {
  await db.execute(
    sql`DELETE FROM guest_response_private_feedback WHERE organization_id = ${ORGANIZATION}`,
  )
  await db.execute(
    sql`DELETE FROM guest_responses WHERE organization_id = ${ORGANIZATION}`,
  )
  await db.execute(sql`DELETE FROM portals WHERE organization_id = ${ORGANIZATION}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORGANIZATION}`)
  await deleteTestOrganizations(lease.pool, [ORGANIZATION])
}

const countRows = async (table: string, where = sql`TRUE`): Promise<number> => {
  const result = await db.execute(
    sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)} WHERE ${where}`,
  )
  return Number((result.rows[0] as { count: number }).count)
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
  await seed()
})

afterAll(async () => {
  if (db) await cleanup()
  await lease.release()
})

describe('retention registry report-only mode', () => {
  it('counts eligible rows without opening an evidence row or deleting anything', async () => {
    const before = {
      retentionRuns: await countRows('retention_runs'),
      responses: await countRows(
        'guest_responses',
        sql`organization_id = ${ORGANIZATION}`,
      ),
      privateFeedback: await countRows(
        'guest_response_private_feedback',
        sql`organization_id = ${ORGANIZATION}`,
      ),
    }

    const report = await buildRetentionRegistryReport({
      db,
      registry: RETENTION_REGISTRY,
      generatedAt: GENERATED_AT,
    })

    expect(report.mode).toBe('report_only')
    expect(report.ruleCount).toBe(RETENTION_REGISTRY.length)
    expect(report.applyBlockedRuleIds).toEqual(RETENTION_REGISTRY.map(({ id }) => id))

    // The seeded rows are visibly eligible, so the report is doing real work
    // rather than trivially reporting zero.
    const facts = report.rules.find(({ ruleId }) => ruleId === 'guest.deidentified_facts')
    expect(facts?.eligibleRows ?? 0).toBeGreaterThan(0)
    const text = report.rules.find(
      ({ ruleId }) => ruleId === 'guest.private_feedback_text',
    )
    expect(text?.eligibleRows ?? 0).toBeGreaterThan(0)

    const after = {
      retentionRuns: await countRows('retention_runs'),
      responses: await countRows(
        'guest_responses',
        sql`organization_id = ${ORGANIZATION}`,
      ),
      privateFeedback: await countRows(
        'guest_response_private_feedback',
        sql`organization_id = ${ORGANIZATION}`,
      ),
    }
    expect(after, 'report-only must not write').toEqual(before)
  })

  it('emits content-free rows only', async () => {
    const report = await buildRetentionRegistryReport({
      db,
      registry: RETENTION_REGISTRY,
      generatedAt: GENERATED_AT,
    })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('expired-by-design fixture')
    expect(serialized).not.toContain(RESPONSE_ID)
    expect(serialized).not.toContain(ORGANIZATION)
    for (const row of report.rules) {
      expect(typeof row.eligibleRows === 'number' || row.eligibleRows === null).toBe(true)
    }
  })

  it('names a real, queryable source column for every countable rule', async () => {
    const report = await buildRetentionRegistryReport({
      db,
      registry: RETENTION_REGISTRY,
      generatedAt: GENERATED_AT,
    })
    // A countable rule that names a column PostgreSQL does not have would have
    // thrown above; this pins the set so a silent downgrade to "not countable"
    // is visible.
    const countable = report.rules
      .filter(({ eligibleRows }) => eligibleRows !== null)
      .map(({ ruleId }) => ruleId)
    expect(countable).toEqual([
      'google.import_discovery',
      'google.import_discovery_invalidations',
      'review.sync_runs',
      'review.refresh_runs',
      'integration.inbound_webhook_receipts',
      'guest.session_pseudonym',
      'guest.destination_action_session_pseudonym',
      'guest.qualified_scan_session_pseudonym',
      'guest.abuse_pseudonym',
      'guest.network_pseudonym',
      'guest.legacy_scan_events.abuse_pseudonym',
      'guest.legacy_scan_events.session_pseudonym',
      'guest.legacy_ratings.abuse_pseudonym',
      'guest.legacy_ratings.session_pseudonym',
      'guest.legacy_feedback.abuse_pseudonym',
      'guest.legacy_feedback.session_pseudonym',
      'guest.optional_contact',
      'guest.private_feedback_text',
      'guest.deidentified_facts',
      'notification.delivery_records',
      'notification.terminal_digest_batches',
      'notification.terminal_email_queue',
      'activity.recent_activity',
      'activity.replay_facts',
      'activity.actor_label_redactions',
      'platform.published_outbox_events',
      'platform.event_consumer_receipts',
      'platform.audit_logs',
      'integration.provider_tokens',
    ])

    // The rest are uncountable for a stated reason, never silently omitted.
    const uncountable = Object.fromEntries(
      report.rules
        .filter(({ eligibleRows }) => eligibleRows === null)
        .map(({ ruleId, notCountableReason }) => [ruleId, notCountableReason]),
    )
    expect(uncountable).toEqual({
      'google.source_content': 'no counsel-approved horizon exists',
      'guest.deidentified_qualified_scan_facts': 'no counsel-approved horizon exists',
      'metric.deidentified_destination_click_facts': 'no counsel-approved horizon exists',
      'metric.deidentified_correction_withdrawal_facts':
        'no counsel-approved horizon exists',
      'metric.lifetime_aggregates': 'retained while its owning aggregate exists',
      'activity.operational_action_history': 'no counsel-approved horizon exists',
      'platform.logs_sentry_replay_screenshots': 'no counsel-approved horizon exists',
      'ai.local_derivatives': 'no counsel-approved horizon exists',
      'platform.uploads': 'no counsel-approved horizon exists',
      'platform.quarantine': 'no counsel-approved horizon exists',
      'lifecycle.organization_exports':
        'object_store sources are not countable from PostgreSQL',
      'platform.backups': 'no counsel-approved horizon exists',
    })
  })

  it('refuses apply for every rule even with the database in hand', () => {
    for (const rule of RETENTION_REGISTRY) {
      expect(() => assertRetentionRegistryApplyAllowed(rule)).toThrowError(
        /pending_counsel/,
      )
    }
  })

  it('never names a contraction candidate beyond the exact redaction allowlist', () => {
    expect(
      retentionRegistryContractionViolations(
        RETENTION_REGISTRY,
        contractionCandidateTableNames(),
      ),
    ).toEqual([])
  })
})
