import { describe, expect, it } from 'vitest'
import { buildOrganizationExportBundle } from '#/contexts/identity/application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import {
  buildNotificationExportEntries,
  type NotificationOrganizationExportPayload,
} from './notification-organization-export.adapter'

const ASOF = new Date('2026-08-28T09:00:00.000Z')

const notification = (id: string, createdAt: string) => ({
  id,
  user_id: 'user-1',
  property_id: '84000000-0000-4000-8000-000000000001',
  type: 'review.created',
  category: 'workflow_collaboration',
  priority: 'normal',
  status: 'unread',
  resource_type: 'inbox_item',
  resource_id: 'inbox-1',
  title: 'New review, "urgent"',
  body: 'A review arrived',
  payload: { platform: 'google', propertyName: 'Test' },
  coalesced_count: 2,
  coalesced_latest_at: createdAt,
  read_at: null,
  created_at: createdAt,
  updated_at: createdAt,
})

const payload = (
  overrides: Partial<NotificationOrganizationExportPayload> = {},
): NotificationOrganizationExportPayload => ({
  version: 'notification-organization-export/v1',
  requestedAsOf: ASOF.toISOString(),
  snapshotBound: 'repeatable_read_within_15m_of_request',
  notifications: [
    notification('a1', '2026-08-01T00:00:00.000000Z'),
    notification('b2', '2026-08-02T00:00:00.000000Z'),
  ],
  preferences: [
    {
      id: 'p1',
      user_id: 'user-1',
      property_id: '84000000-0000-4000-8000-000000000001',
      category: 'workflow_collaboration',
      channel: 'email',
      enabled: false,
      cadence: 'daily',
      urgent_bypass_enabled: false,
      quiet_hours_start: null,
      quiet_hours_end: null,
      created_at: '2026-08-01T00:00:00.000000Z',
      updated_at: '2026-08-01T00:00:00.000000Z',
    },
  ],
  userSettings: [
    {
      id: 's1',
      user_id: 'user-1',
      locale: 'en',
      timezone: 'Europe/Sofia',
      created_at: '2026-08-01T00:00:00.000000Z',
      updated_at: '2026-08-01T00:00:00.000000Z',
    },
  ],
  excludedRecordClasses: [
    { recordClass: 'notification_email_delivery_queue', reasonCode: 'delivery_queue' },
  ],
  ...overrides,
})

const text = (entries: readonly { path: string; bytes: Uint8Array }[], path: string) =>
  Buffer.from(entries.find((entry) => entry.path === path)!.bytes).toString('utf8')

describe('Notification Organization Export entries', () => {
  it('renders identical bytes regardless of the order rows arrive in', () => {
    const ordered = payload()
    const reversed = payload({
      notifications: [...ordered.notifications].reverse(),
    })

    expect(buildNotificationExportEntries(reversed)).toEqual(
      buildNotificationExportEntries(ordered),
    )
  })

  it('sorts records by UTF-8 byte order of (created_at, id)', () => {
    const csv = text(
      buildNotificationExportEntries(
        payload({
          notifications: [
            notification('b2', '2026-08-02T00:00:00.000000Z'),
            notification('a1', '2026-08-01T00:00:00.000000Z'),
          ],
        }),
      ),
      'notification/notifications.csv',
    ).split('\n')

    expect(csv[1]?.startsWith('a1,')).toBe(true)
    expect(csv[2]?.startsWith('b2,')).toBe(true)
  })

  it('classifies every entry tenant_visible and pairs CSV with JSON under notification/', () => {
    const entries = buildNotificationExportEntries(payload())

    expect(
      entries.map(({ path, mediaType, classification }) => ({
        path,
        mediaType,
        classification,
      })),
    ).toEqual([
      {
        path: 'notification/notifications.csv',
        mediaType: 'text/csv',
        classification: 'tenant_visible',
      },
      {
        path: 'notification/notifications.json',
        mediaType: 'application/json',
        classification: 'tenant_visible',
      },
      {
        path: 'notification/preferences.csv',
        mediaType: 'text/csv',
        classification: 'tenant_visible',
      },
      {
        path: 'notification/preferences.json',
        mediaType: 'application/json',
        classification: 'tenant_visible',
      },
      {
        path: 'notification/user-settings.csv',
        mediaType: 'text/csv',
        classification: 'tenant_visible',
      },
      {
        path: 'notification/user-settings.json',
        mediaType: 'application/json',
        classification: 'tenant_visible',
      },
    ])
  })

  it('exports no delivery-pipeline column — no queue, receipt, provider or correlation field', () => {
    const entries = buildNotificationExportEntries(payload())
    const headers = [
      text(entries, 'notification/notifications.csv').split('\n')[0],
      text(entries, 'notification/preferences.csv').split('\n')[0],
      text(entries, 'notification/user-settings.csv').split('\n')[0],
    ]

    expect(headers).toEqual([
      'id,user_id,property_id,type,category,priority,status,resource_type,resource_id,title,body,payload,coalesced_count,coalesced_latest_at,read_at,created_at,updated_at',
      'id,user_id,property_id,category,channel,enabled,cadence,urgent_bypass_enabled,quiet_hours_start,quiet_hours_end,created_at,updated_at',
      'id,user_id,locale,timezone,created_at,updated_at',
    ])
    const archive = entries
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')
    for (const forbidden of [
      'provider_message_id',
      'provider_state',
      'idempotency_key',
      'accepted_at',
      'delivered_at',
      'bounced_at',
      'retry_count',
      'suppression_reason',
      'content_digest',
      'quarantined_at',
      'event_id',
    ]) {
      expect(archive).not.toContain(forbidden)
    }
  })

  it('is accepted by the Organization Export bundle builder', async () => {
    const entries = buildNotificationExportEntries(payload())
    const bundle = await buildOrganizationExportBundle({
      organizationId: 'org-1',
      requestId: 'req-1',
      asOf: ASOF,
      contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
        context === 'notification'
          ? {
              context,
              contribute: async () => ({
                context,
                coverage: 'complete' as const,
                omissionCodes: [],
                entries,
              }),
            }
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
      expect.arrayContaining(entries.map(({ path }) => path)),
    )
  })
})
