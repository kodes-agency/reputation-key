import { describe, expect, it } from 'vitest'
import { buildOrganizationExportBundle } from '#/contexts/identity/application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import {
  organizationId,
  propertyId,
  recentActivityEntryId,
  userId,
} from '#/shared/domain/ids'
import type { RecentActivityEntry } from '../../domain/types'
import { withRedactedRecentActivityActor } from '../../domain/constructors'
import {
  buildActivityExportEntries,
  toExportedEntry,
  type ActivityOrganizationExportPayload,
} from './activity-organization-export.adapter'

const ASOF = new Date('2026-08-28T09:00:00.000Z')

const row = (id: string, createdAt: string, redacted = false) => ({
  id,
  actor_id: 'user-1',
  actor_name: 'Dana Manager',
  actor_avatar_url: 'https://cdn.example.test/avatar',
  actor_role: 'AccountAdmin',
  action: 'published',
  resource_type: 'reply',
  resource_id: 'reply-1',
  property_id: '84000000-0000-4000-8000-000000000001',
  payload: { subject: 'Reply', from: null, to: null, detail: null },
  source: 'web',
  created_at: createdAt,
  actor_label_redacted: redacted,
})

const payload = (
  overrides: Partial<ActivityOrganizationExportPayload> = {},
): ActivityOrganizationExportPayload => ({
  version: 'activity-organization-export/v1',
  requestedAsOf: ASOF.toISOString(),
  snapshotBound: 'repeatable_read_within_15m_of_request',
  recentActivity: [
    toExportedEntry(row('a1', '2026-08-01T00:00:00.000000Z')),
    toExportedEntry(row('b2', '2026-08-02T00:00:00.000000Z')),
  ],
  excludedRecordClasses: [
    {
      recordClass: 'operational_action_history',
      reasonCode: 'restricted_operational_action_history',
    },
  ],
  ...overrides,
})

const text = (entries: readonly { path: string; bytes: Uint8Array }[], path: string) =>
  Buffer.from(entries.find((entry) => entry.path === path)!.bytes).toString('utf8')

describe('Activity Organization Export entries', () => {
  it('renders identical bytes regardless of the order rows arrive in', () => {
    const ordered = payload()
    const reversed = payload({ recentActivity: [...ordered.recentActivity].reverse() })

    expect(buildActivityExportEntries(reversed)).toEqual(
      buildActivityExportEntries(ordered),
    )
  })

  it('sorts records by UTF-8 byte order of (created_at, id)', () => {
    const csv = text(
      buildActivityExportEntries(
        payload({
          recentActivity: [
            toExportedEntry(row('b2', '2026-08-02T00:00:00.000000Z')),
            toExportedEntry(row('a1', '2026-08-01T00:00:00.000000Z')),
          ],
        }),
      ),
      'activity/recent-activity.csv',
    ).split('\n')

    expect(csv[1]?.startsWith('a1,')).toBe(true)
    expect(csv[2]?.startsWith('b2,')).toBe(true)
  })

  it('classifies both entries tenant_visible under activity/', () => {
    expect(
      buildActivityExportEntries(payload()).map(
        ({ path, mediaType, classification }) => ({ path, mediaType, classification }),
      ),
    ).toEqual([
      {
        path: 'activity/recent-activity.csv',
        mediaType: 'text/csv',
        classification: 'tenant_visible',
      },
      {
        path: 'activity/recent-activity.json',
        mediaType: 'application/json',
        classification: 'tenant_visible',
      },
    ])
  })

  it('applies exactly the actor redaction this context already writes', () => {
    const source: RecentActivityEntry = {
      id: recentActivityEntryId('11111111-1111-4111-8111-111111111111'),
      actorId: userId('user-1'),
      actorName: 'Dana Manager',
      actorAvatarUrl: 'https://cdn.example.test/avatar',
      actorRole: 'AccountAdmin',
      action: 'published',
      resourceType: 'reply',
      resourceId: 'reply-1',
      propertyId: propertyId('84000000-0000-4000-8000-000000000001'),
      organizationId: organizationId('org-1'),
      payload: { subject: 'Reply', from: null, to: null, detail: null },
      source: 'web',
      eventId: 'event-1',
      createdAt: ASOF,
    }
    const redacted = withRedactedRecentActivityActor(source)

    const exported = toExportedEntry(row('a1', '2026-08-01T00:00:00.000000Z', true))

    expect(exported).toMatchObject({
      actor_id: redacted.actorId as string,
      actor_name: redacted.actorName,
      actor_avatar_url: redacted.actorAvatarUrl,
      actor_role: redacted.actorRole,
    })
    expect(exported.actor_name).not.toBe(source.actorName)
  })

  it('never exports the redaction fence marker or the source correlation id', () => {
    const archive = buildActivityExportEntries(
      payload({
        recentActivity: [toExportedEntry(row('a1', '2026-08-01T00:00:00.000000Z', true))],
      }),
    )
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')

    expect(archive).not.toContain('actor_label_redacted')
    expect(archive).not.toContain('event_id')
    expect(archive).not.toContain('actor_subject_id')
  })

  it('is accepted by the Organization Export bundle builder', async () => {
    const entries = buildActivityExportEntries(payload())
    const bundle = await buildOrganizationExportBundle({
      organizationId: 'org-1',
      requestId: 'req-1',
      asOf: ASOF,
      contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
        context === 'activity'
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
      expect.arrayContaining([
        'activity/recent-activity.csv',
        'activity/recent-activity.json',
      ]),
    )
  })
})
