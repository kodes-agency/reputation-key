import { randomUUID } from 'node:crypto'
import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildOrganizationExportBundle } from '#/contexts/identity/application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import {
  REDACTED_RECENT_ACTIVITY_ACTOR_NAME,
  SYSTEM_USER_ID,
} from '../../domain/constructors'
import { createActivityOrganizationExportContributor } from './activity-organization-export.adapter'

let lease: TestLease
let db: Database
const organizations = new Set<string>()

type Fixture = Readonly<{
  organizationId: string
  propertyId: string
  actorId: string
  redactedActorId: string
  visibleEntryId: string
  redactedEntryId: string
  holdId: string
  historyRecordId: string
  createdAt: Date
}>

const FINGERPRINT = 'b'.repeat(64)

async function seedFixture(): Promise<Fixture> {
  const suffix = randomUUID()
  const createdAt = new Date(Date.now() - 60_000)
  const fixture: Fixture = {
    organizationId: `activity-export-org-${suffix}`,
    propertyId: `activity-export-property-${suffix}`,
    actorId: `activity-export-actor-${suffix}`,
    redactedActorId: `activity-export-former-${suffix}`,
    visibleEntryId: randomUUID(),
    redactedEntryId: randomUUID(),
    holdId: randomUUID(),
    historyRecordId: randomUUID(),
    createdAt,
  }
  organizations.add(fixture.organizationId)

  await lease.pool.query(
    `INSERT INTO recent_activity_entries (
       id, actor_id, actor_name, actor_avatar_url, actor_role, action,
       resource_type, resource_id, property_id, organization_id, payload,
       event_id, source, created_at
     ) VALUES ($1, $2, 'Dana Manager', 'https://cdn.example.test/avatar',
               'AccountAdmin', 'published', 'reply', 'reply-1', $3, $4,
               '{"subject":"Reply","from":null,"to":null,"detail":null}'::jsonb,
               $5, 'web', $6)`,
    [
      fixture.visibleEntryId,
      fixture.actorId,
      fixture.propertyId,
      fixture.organizationId,
      `NEVER_EXPORT_EVENT_${suffix}`,
      createdAt,
    ],
  )
  // The projection row still carries the original label: actor-label redaction
  // is bounded to 100 rows per call, so the fence can outrun the rewrite.
  await lease.pool.query(
    `INSERT INTO recent_activity_entries (
       id, actor_id, actor_name, actor_avatar_url, actor_role, action,
       resource_type, resource_id, property_id, organization_id, payload,
       event_id, source, created_at
     ) VALUES ($1, $2, 'NEVER_EXPORT_FORMER_MEMBER_NAME',
               'https://cdn.example.test/NEVER_EXPORT_FORMER_AVATAR',
               'AccountAdmin', 'created', 'property', 'property-1', $3, $4,
               '{"subject":"Property","from":null,"to":null,"detail":null}'::jsonb,
               $5, 'web', $6)`,
    [
      fixture.redactedEntryId,
      fixture.redactedActorId,
      fixture.propertyId,
      fixture.organizationId,
      `NEVER_EXPORT_EVENT_REDACTED_${suffix}`,
      new Date(createdAt.getTime() + 1000),
    ],
  )
  await lease.pool.query(
    `INSERT INTO recent_activity_actor_label_redactions (
       organization_id, actor_subject_id, redacted_at, expires_at
     ) VALUES ($1, $2, $3, $4)`,
    [
      fixture.organizationId,
      fixture.redactedActorId,
      createdAt,
      new Date(createdAt.getTime() + 90 * 24 * 60 * 60 * 1000),
    ],
  )

  // Control-plane and restricted material the export must never read.
  await lease.pool.query(
    `INSERT INTO recent_activity_replay_facts (
       replay_key, projection_id, source_kind, disposition, source_event_id,
       source_event_type, source_event_version, source_context,
       source_aggregate_id, organization_id, property_id, actor_subject_id,
       action, resource_type, resource_id, transition_payload, source,
       source_occurred_at, captured_at
     ) VALUES ($1, $2, 'durable_fact', 'projectable', $3,
               'review.reply.published', 1, 'review', 'reply-1', $4, $5, $6,
               'published', 'reply', 'reply-1', '{"subject":"Reply"}'::jsonb,
               'web', $7, $7)`,
    [
      `NEVER_EXPORT_REPLAY_KEY_${suffix}`,
      fixture.visibleEntryId,
      `NEVER_EXPORT_REPLAY_EVENT_${suffix}`,
      fixture.organizationId,
      fixture.propertyId,
      fixture.actorId,
      createdAt,
    ],
  )
  await lease.pool.query(
    `INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
     VALUES ('activity_vocabulary_reconciliation', $1, jsonb_build_object(
       'organizationId', $2::text,
       'targetFingerprintSha256', $3::text,
       'authorizedBy', $4::text,
       'authorizationEvidenceRef', $5::text
     ), $6::timestamptz)`,
    [
      randomUUID(),
      fixture.organizationId,
      FINGERPRINT,
      `NEVER_EXPORT_AUTHORIZER_${suffix}`,
      `NEVER-EXPORT-EVIDENCE-${suffix}`,
      createdAt,
    ],
  )
  await lease.pool.query(
    `INSERT INTO audit_logs (
       id, organization_id, user_id, action, resource_type, resource_id,
       details, success, created_at, updated_at
     ) VALUES ($1, $2, $3, 'legacy.action', 'goal', 'goal-1',
               '{"note":"NEVER_EXPORT_AUDIT_DETAIL"}'::jsonb, true, $4, $4)`,
    [`NEVER_EXPORT_AUDIT_${suffix}`, fixture.organizationId, fixture.actorId, createdAt],
  )
  // Restricted Operational Action History (LIF-01 bullet 7). Migration 0149
  // forbids UPDATE/DELETE on these rows, so the fixture is deliberately
  // append-only and is left behind in the disposable test database.
  await lease.pool.query(
    `INSERT INTO operational_action_history_heads (
       organization_id, last_sequence, last_recorded_at, updated_at
     ) VALUES ($1, 1, $2, $2)`,
    [fixture.organizationId, createdAt],
  )
  await lease.pool.query(
    `INSERT INTO operational_action_history_records (
       id, organization_id, sequence, property_id, actor_type, actor_id, action,
       outcome, resource_type, resource_id, reason_code, provenance_kind,
       provenance_id, source_event_type, source_event_version, source_context,
       source_aggregate_id, occurred_at, recorded_at
     ) VALUES ($1, $2, 1, $3, 'user', $4, 'google_reply.published', 'succeeded',
               'reply', $5, 'manager_requested', 'domain_fact', $6,
               'review.reply.published', 1, 'review', 'reply-1', $7, $7)`,
    [
      fixture.historyRecordId,
      fixture.organizationId,
      fixture.propertyId,
      fixture.actorId,
      `NEVER-EXPORT-HISTORY-RESOURCE-${suffix}`,
      `NEVER-EXPORT-PROVENANCE-${suffix}`,
      createdAt,
    ],
  )
  await lease.pool.query(
    `INSERT INTO operational_action_history_legal_holds (
       id, organization_id, reason_code, protects_from, placed_at,
       placed_by_actor_id
     ) VALUES ($1, $2, 'never_export_hold_reason', $3, $3, $4)`,
    [
      fixture.holdId,
      fixture.organizationId,
      createdAt,
      `NEVER-EXPORT-HOLD-ACTOR-${suffix}`,
    ],
  )
  return fixture
}

describe.sequential('Activity Organization Export contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    const ids = [...organizations]
    await lease.pool.query(
      `DELETE FROM idempotency_receipts
       WHERE scope = 'activity_vocabulary_reconciliation'
         AND payload->>'organizationId' = ANY($1::text[])`,
      [ids],
    )
    for (const table of [
      'recent_activity_entries',
      'recent_activity_replay_facts',
      'recent_activity_actor_label_redactions',
      'audit_logs',
    ]) {
      await lease.pool.query(
        `DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`,
        [ids],
      )
    }
    organizations.clear()
  })

  it('exports Recent Activity only — never restricted Operational Action History', async () => {
    const fixture = await seedFixture()
    const asOf = new Date(Date.now() - 1000)
    const contributor = createActivityOrganizationExportContributor(db)

    const first = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
    })
    const replay = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
    })

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      context: 'activity',
      coverage: 'complete',
      omissionCodes: [],
    })
    expect(first.entries.map(({ path, mediaType }) => ({ path, mediaType }))).toEqual([
      { path: 'activity/recent-activity.csv', mediaType: 'text/csv' },
      { path: 'activity/recent-activity.json', mediaType: 'application/json' },
    ])

    const payload = JSON.parse(
      Buffer.from(
        first.entries.find(({ mediaType }) => mediaType === 'application/json')!.bytes,
      ).toString('utf8'),
    ) as Record<string, unknown>
    expect(payload).toMatchObject({
      version: 'activity-organization-export/v1',
      recentActivity: [
        {
          id: fixture.visibleEntryId,
          actor_id: fixture.actorId,
          actor_name: 'Dana Manager',
          action: 'published',
          resource_type: 'reply',
          property_id: fixture.propertyId,
          source: 'web',
        },
        {
          id: fixture.redactedEntryId,
          actor_id: SYSTEM_USER_ID as string,
          actor_name: REDACTED_RECENT_ACTIVITY_ACTOR_NAME,
          actor_avatar_url: null,
          actor_role: 'Staff',
        },
      ],
    })

    const archive = first.entries
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')
    expect(archive).not.toContain('NEVER_EXPORT_')
    expect(archive).not.toContain('NEVER-EXPORT-')
    expect(archive).not.toContain(fixture.redactedActorId)
    expect(archive).not.toContain(fixture.historyRecordId)
    expect(archive).not.toContain(fixture.holdId)
    expect(archive).not.toContain(FINGERPRINT)

    const bundle = await buildOrganizationExportBundle({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
      contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
        context === 'activity'
          ? contributor
          : {
              context,
              contribute: async () => ({
                context,
                coverage: 'no_data' as const,
                omissionCodes: [],
                entries: [],
              }),
            },
      ),
    })
    expect(bundle.entries.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        'activity/recent-activity.csv',
        'activity/recent-activity.json',
      ]),
    )
  })

  it('answers no_data — never falling back to Operational Action History — when the feed is empty', async () => {
    const suffix = randomUUID()
    const organizationId = `activity-export-empty-org-${suffix}`
    organizations.add(organizationId)
    await lease.pool.query(
      `INSERT INTO operational_action_history_heads (
         organization_id, last_sequence, last_recorded_at, updated_at
       ) VALUES ($1, 0, NULL, NOW())`,
      [organizationId],
    )

    const contribution = await createActivityOrganizationExportContributor(db).contribute(
      {
        organizationId,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 1000),
      },
    )

    expect(contribution).toEqual({
      context: 'activity',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('fails closed when a queued request is outside the bounded snapshot window', async () => {
    const fixture = await seedFixture()

    await expect(
      createActivityOrganizationExportContributor(db).contribute({
        organizationId: fixture.organizationId,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
