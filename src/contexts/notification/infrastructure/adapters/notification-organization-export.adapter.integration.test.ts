import { randomUUID } from 'node:crypto'
import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildOrganizationExportBundle } from '#/contexts/identity/application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import { createNotificationOrganizationExportContributor } from './notification-organization-export.adapter'

let lease: TestLease
let db: Database
const organizations = new Set<string>()

type Fixture = Readonly<{
  organizationId: string
  propertyId: string
  userId: string
  notificationId: string
  preferenceId: string
  userSettingsId: string
  emailId: string
  batchId: string
  quarantinedNotificationId: string
  quarantinedPreferenceId: string
  createdAt: Date
}>

const DIGEST = 'a'.repeat(64)

async function seedFixture(): Promise<Fixture> {
  const suffix = randomUUID()
  const createdAt = new Date(Date.now() - 60_000)
  const fixture: Fixture = {
    organizationId: `notification-export-org-${suffix}`,
    propertyId: randomUUID(),
    userId: `notification-export-user-${suffix}`,
    notificationId: randomUUID(),
    preferenceId: randomUUID(),
    userSettingsId: randomUUID(),
    emailId: randomUUID(),
    batchId: randomUUID(),
    quarantinedNotificationId: randomUUID(),
    quarantinedPreferenceId: randomUUID(),
    createdAt,
  }
  organizations.add(fixture.organizationId)

  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Notification Export Property', $3, 'Europe/Sofia')`,
    [fixture.propertyId, fixture.organizationId, `notification-export-${suffix}`],
  )
  await lease.pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, body, payload,
       coalesced_count, coalesced_latest_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'review.created', 'workflow_collaboration', 'normal',
               'unread', 'inbox_item', 'inbox-item-1', $5,
               'New review needs a reply', 'A guest left a new review',
               '{"platform":"google"}'::jsonb, 2, $6, $6, $6)`,
    [
      fixture.notificationId,
      fixture.userId,
      fixture.organizationId,
      fixture.propertyId,
      `NEVER_EXPORT_EVENT_${suffix}`,
      createdAt,
    ],
  )
  await lease.pool.query(
    `INSERT INTO notification_preferences (
       id, user_id, organization_id, property_id, category, channel, enabled,
       cadence, urgent_bypass_enabled, quiet_hours_start, quiet_hours_end,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'workflow_collaboration', 'email', false,
               'daily', false, '09:00', '17:00', $5, $5)`,
    [
      fixture.preferenceId,
      fixture.userId,
      fixture.organizationId,
      fixture.propertyId,
      createdAt,
    ],
  )
  await lease.pool.query(
    `INSERT INTO notification_user_settings (
       id, user_id, organization_id, locale, timezone, created_at, updated_at
     ) VALUES ($1, $2, $3, 'en', 'Europe/Sofia', $4, $4)`,
    [fixture.userSettingsId, fixture.userId, fixture.organizationId, createdAt],
  )

  // Delivery machinery. LIF-01 bullet 7 excludes queues, outbox, receipts and
  // rate limits, and this is exactly that material.
  await lease.pool.query(
    `INSERT INTO notification_email_queue (
       id, notification_id, user_id, organization_id, property_id, category,
       cadence, status, priority, idempotency_key, provider_message_id,
       provider_state, last_error_class, suppression_reason,
       accepted_at, delivered_at, retry_count, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'workflow_collaboration', 'daily', 'sent',
               'normal', $6, $7, 'delivered', 'NEVER_EXPORT_ERROR_CLASS',
               'NEVER_EXPORT_SUPPRESSION', $8, $8, 3, $8, $8)`,
    [
      fixture.emailId,
      fixture.notificationId,
      fixture.userId,
      fixture.organizationId,
      fixture.propertyId,
      `NEVER_EXPORT_IDEMPOTENCY_${suffix}`,
      `NEVER_EXPORT_PROVIDER_${suffix}`,
      createdAt,
    ],
  )
  await lease.pool.query(
    `INSERT INTO notification_digest_batches (
       id, organization_id, user_id, local_date, sequence, member_digest,
       content_digest, provider_idempotency_key, unsubscribe_key_version, state,
       provider_message_id, created_at, updated_at
     ) VALUES ($1, $2, $3, '2026-08-27', 1, $4, $4, $5, 'legacy', 'accepted',
               $6, $7, $7)`,
    [
      fixture.batchId,
      fixture.organizationId,
      fixture.userId,
      DIGEST,
      `NEVER_EXPORT_BATCH_KEY_${suffix}`,
      `NEVER_EXPORT_BATCH_PROVIDER_${suffix}`,
      createdAt,
    ],
  )
  await lease.pool.query(
    `INSERT INTO notification_digest_batch_members (
       batch_id, organization_id, user_id, notification_email_id, sort_index, created_at
     ) VALUES ($1, $2, $3, $4, 0, $5)`,
    [fixture.batchId, fixture.organizationId, fixture.userId, fixture.emailId, createdAt],
  )
  await lease.pool.query(
    `INSERT INTO notification_governance_quarantine (
       notification_id, organization_id, reason, quarantined_at
     ) VALUES ($1, $2, 'NEVER_EXPORT_QUARANTINE', $3)`,
    [fixture.quarantinedNotificationId, fixture.organizationId, createdAt],
  )
  await lease.pool.query(
    `INSERT INTO notification_preference_governance_quarantine (
       legacy_preference_id, organization_id, reason, quarantined_at
     ) VALUES ($1, $2, 'NEVER_EXPORT_PREFERENCE_QUARANTINE', $3)`,
    [fixture.quarantinedPreferenceId, fixture.organizationId, createdAt],
  )
  return fixture
}

describe.sequential('Notification Organization Export contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    const ids = [...organizations]
    for (const table of [
      'notification_digest_batch_members',
      'notification_digest_batches',
      'notification_email_queue',
      'notification_governance_quarantine',
      'notification_preference_governance_quarantine',
      'notifications',
      'notification_preferences',
      'notification_user_settings',
      'properties',
    ]) {
      await lease.pool.query(
        `DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`,
        [ids],
      )
    }
    organizations.clear()
  })

  it('exports the tenant-visible notification record without queue, receipt or governance material', async () => {
    const fixture = await seedFixture()
    const asOf = new Date(Date.now() - 1000)
    const contributor = createNotificationOrganizationExportContributor(db)

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
      context: 'notification',
      coverage: 'complete',
      omissionCodes: [],
    })
    expect(first.entries.map(({ path, mediaType }) => ({ path, mediaType }))).toEqual([
      { path: 'notification/notifications.csv', mediaType: 'text/csv' },
      { path: 'notification/notifications.json', mediaType: 'application/json' },
      { path: 'notification/preferences.csv', mediaType: 'text/csv' },
      { path: 'notification/preferences.json', mediaType: 'application/json' },
      { path: 'notification/user-settings.csv', mediaType: 'text/csv' },
      { path: 'notification/user-settings.json', mediaType: 'application/json' },
    ])

    const read = (path: string) =>
      JSON.parse(
        Buffer.from(first.entries.find((entry) => entry.path === path)!.bytes).toString(
          'utf8',
        ),
      ) as Record<string, unknown>
    expect(read('notification/notifications.json')).toMatchObject({
      version: 'notification-organization-export/v1',
      notifications: [
        {
          id: fixture.notificationId,
          user_id: fixture.userId,
          property_id: fixture.propertyId,
          type: 'review.created',
          status: 'unread',
          title: 'New review needs a reply',
          body: 'A guest left a new review',
          payload: { platform: 'google' },
          coalesced_count: 2,
        },
      ],
    })
    expect(read('notification/preferences.json')).toMatchObject({
      preferences: [
        {
          id: fixture.preferenceId,
          category: 'workflow_collaboration',
          channel: 'email',
          enabled: false,
          cadence: 'daily',
          quiet_hours_start: '09:00:00',
        },
      ],
    })
    expect(read('notification/user-settings.json')).toMatchObject({
      userSettings: [
        { id: fixture.userSettingsId, locale: 'en', timezone: 'Europe/Sofia' },
      ],
    })

    const archive = first.entries
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')
    expect(archive).not.toContain('NEVER_EXPORT_')
    expect(archive).not.toContain(fixture.emailId)
    expect(archive).not.toContain(fixture.batchId)
    expect(archive).not.toContain(fixture.quarantinedNotificationId)
    expect(archive).not.toContain(fixture.quarantinedPreferenceId)

    const bundle = await buildOrganizationExportBundle({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
      contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
        context === 'notification'
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
        'notification/notifications.csv',
        'notification/notifications.json',
        'notification/preferences.csv',
        'notification/preferences.json',
        'notification/user-settings.csv',
        'notification/user-settings.json',
      ]),
    )
  })

  it('answers no_data — never an invented empty CSV — when only delivery machinery exists', async () => {
    const suffix = randomUUID()
    const organizationId = `notification-export-empty-org-${suffix}`
    organizations.add(organizationId)

    const contribution = await createNotificationOrganizationExportContributor(
      db,
    ).contribute({
      organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })

    expect(contribution).toEqual({
      context: 'notification',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('fails closed when a queued request is outside the bounded snapshot window', async () => {
    const fixture = await seedFixture()

    await expect(
      createNotificationOrganizationExportContributor(db).contribute({
        organizationId: fixture.organizationId,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
