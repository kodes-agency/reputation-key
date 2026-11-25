import { NOTIFICATION_RIGHTS_TABLES } from '../domain/notification-rights-tables'
import { randomUUID } from 'node:crypto'
import {
  APPLY_TOKENS,
  type Tenant,
  applyTokens,
  bindRightsDatabase,
  canonical,
  capturingJournal,
  count,
  dumpOrganization,
  organizationApply,
  organizations,
  outsideProperty,
  propertyApply,
  recordingWriter,
  replayThroughFence,
  restoreRows,
  rowTotal,
  runRights,
  seedTenant,
} from './notification-rights.test-fixtures'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  getFormerMemberRemovals,
  getNotificationHistory,
  getNotificationPreferences,
  getNotificationUserSettings,
} from './read.server'
import { purgeNotificationRightsData } from './purge.server'
import {
  buildManualFinalWarning,
  createNotificationRightsPort,
  runNotificationRights,
  type ManualFinalWarning,
} from './executor.server'
import { createNotificationAudienceAuthorizer } from '../notify/notification-audience.server'
import { createNoticeWriter } from '../notify/consumers.server'
import { waitingWorkState } from '../infrastructure/jobs/test-fixtures'
import { currentRouteDeps } from '#/shared/testing/notification-route-test-harness'
import { createOrganizationAccountNotificationAuthority } from '../notify/organization-account-notification-authority.adapter.server'
import {
  notificationEmailId,
  notificationId,
  organizationId as brandOrganization,
  userId as brandUser,
} from '#/shared/domain/ids'
import { createRightsJournal } from '#/shared/ops/rights/rights-journal'

let lease: TestLease
let db: Database

describe.sequential('Notification rights reads and purge', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
    bindRightsDatabase(lease, db)
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    const ids = [...organizations]
    for (const table of [
      'notification_digest_batch_members',
      'notification_digest_batches',
      'notification_unsubscribe_scopes',
      'notification_email_queue',
      'notifications',
      'notification_preferences',
      'notification_category_defaults',
      'notification_property_delivery_windows',
      'notification_user_settings',
      'outbox_events',
      'properties',
    ]) {
      await lease.pool.query(
        `DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`,
        [ids],
      )
    }
    await lease.pool.query(`DELETE FROM organization WHERE id = ANY($1::text[])`, [ids])
    organizations.clear()
  })

  it('reads only the named tenant, through allowlisted fields', async () => {
    const a = await seedTenant()
    const b = await seedTenant()

    const history = await getNotificationHistory(db, { organizationId: a.organizationId })
    expect(history).toHaveLength(3)
    expect(history.every((r) => r.organizationId === a.organizationId)).toBe(true)
    expect(Object.keys(history[0]?.fields ?? {})).not.toContain('eventId')

    const property = await getNotificationHistory(db, {
      organizationId: a.organizationId,
      propertyId: a.propertyId,
    })
    expect(property).toHaveLength(1)
    // The Organization-wide default has no Property and is not part of this read.
    await lease.pool.query(
      `INSERT INTO notification_preferences (
         id, user_id, organization_id, property_id, category, channel, enabled,
         cadence, created_at, updated_at
       ) VALUES ($1, $2, $3, NULL, 'workflow_collaboration', 'email', true, 'immediate', $4, $4)
       ON CONFLICT DO NOTHING`,
      [randomUUID(), b.userId, b.organizationId, new Date()],
    )
    expect(
      await getNotificationPreferences(db, { organizationId: b.organizationId }),
    ).toHaveLength(2)
    expect(
      await getNotificationUserSettings(db, { organizationId: a.organizationId }),
    ).toHaveLength(1)
    expect(
      await getNotificationUserSettings(db, {
        organizationId: a.organizationId,
        propertyId: a.propertyId,
      }),
    ).toEqual([])
    const former = await getFormerMemberRemovals(db, { organizationId: a.organizationId })
    expect(former.map((r) => r.fields.userId)).toEqual([a.userId])
  })

  const BEFORE = {
    notification_digest_batch_members: 2,
    notification_digest_batches: 1,
    notification_email_queue: 2,
    notifications: 3,
    notification_preferences: 2,
    notification_category_defaults: 1,
    notification_property_delivery_windows: 2,
    notification_user_settings: 1,
    notification_unsubscribe_scopes: 2,
  } as const

  const countsOf = async (organizationId: string) =>
    Object.fromEntries(
      await Promise.all(
        Object.keys(BEFORE).map(async (table) => [
          table,
          await count(table, organizationId),
        ]),
      ),
    )

  it('purges a Property, digest members included, without touching its sibling or another tenant', async () => {
    const a = await seedTenant()
    const b = await seedTenant()
    expect(await countsOf(a.organizationId)).toEqual(BEFORE)

    const deleted = await purgeNotificationRightsData(
      db,
      { organizationId: a.organizationId, propertyId: a.propertyId },
      1,
    )

    expect(Object.keys(deleted).sort()).toEqual(
      [...NOTIFICATION_RIGHTS_TABLES.property].sort(),
    )
    expect(deleted).toEqual({
      notification_digest_batch_members: 1,
      notification_email_queue: 1,
      notifications: 1,
      notification_preferences: 1,
      notification_property_delivery_windows: 1,
      notification_unsubscribe_scopes: 1,
    })
    expect(await countsOf(a.organizationId)).toEqual({
      notification_digest_batch_members: 1,
      notification_digest_batches: 1,
      notification_email_queue: 1,
      notifications: 2,
      notification_preferences: 1,
      notification_category_defaults: 1,
      notification_property_delivery_windows: 1,
      notification_user_settings: 1,
      notification_unsubscribe_scopes: 1,
    })
    const survivor = await lease.pool.query(
      `SELECT q.property_id FROM notification_digest_batch_members m
         JOIN notification_email_queue q ON q.id = m.notification_email_id
        WHERE m.organization_id = $1`,
      [a.organizationId],
    )
    expect(survivor.rows.map((r) => r.property_id)).toEqual([a.otherPropertyId])
    expect(await countsOf(b.organizationId)).toEqual(BEFORE)
  })

  it('purges an Organization in batches, every table, and leaves the other tenant intact', async () => {
    const a = await seedTenant()
    const b = await seedTenant()

    const deleted = await purgeNotificationRightsData(
      db,
      { organizationId: a.organizationId },
      1,
    )

    expect(deleted).toEqual(BEFORE)
    expect(Object.keys(deleted).sort()).toEqual(
      [...NOTIFICATION_RIGHTS_TABLES.organization].sort(),
    )
    expect(Object.values(await countsOf(a.organizationId)).every((n) => n === 0)).toBe(
      true,
    )
    expect(await countsOf(b.organizationId)).toEqual(BEFORE)
    expect(
      await purgeNotificationRightsData(db, { organizationId: a.organizationId }, 1),
    ).toEqual(Object.fromEntries(Object.keys(BEFORE).map((t) => [t, 0])))
  })

  const heldRows = async (
    organizationId: string,
    propertyId?: string,
  ): Promise<Record<string, number>> => {
    const port = createNotificationRightsPort(db, recordingWriter())
    const result = await runNotificationRights(port, {
      scope: propertyId ? 'property' : 'organization',
      mode: 'report',
      organizationId,
      ...(propertyId ? { propertyId } : {}),
      batchSize: 50,
    })
    const line = result.lines.find((entry) => entry.startsWith('rows held: '))
    return Object.fromEntries(
      (line ?? '')
        .slice('rows held: '.length)
        .split(' ')
        .map((pair) => {
          const [table = '', rows = ''] = pair.split('=')
          return [table, Number(rows)]
        }),
    )
  }

  const removed = (before: Record<string, number>, after: Record<string, number>) =>
    Object.fromEntries(
      Object.keys(before).map((table) => [
        table,
        (before[table] ?? 0) - (after[table] ?? 0),
      ]),
    )

  it('reports the rows a Property purge removes, per table, and not its sibling or another tenant', async () => {
    const a = await seedTenant()
    const b = await seedTenant()
    const reported = await heldRows(a.organizationId, a.propertyId)
    const sibling = await heldRows(a.organizationId, a.otherPropertyId)
    const otherTenant = await heldRows(b.organizationId, b.propertyId)
    const before = await countsOf(a.organizationId)

    await purgeNotificationRightsData(
      db,
      { organizationId: a.organizationId, propertyId: a.propertyId },
      50,
    )

    const after = await countsOf(a.organizationId)
    const actual = removed(before, after)
    expect(reported).toEqual(
      Object.fromEntries(
        NOTIFICATION_RIGHTS_TABLES.property.map((table) => [table, actual[table]]),
      ),
    )
    expect(reported).toEqual({
      notification_digest_batch_members: 1,
      notification_email_queue: 1,
      notifications: 1,
      notification_preferences: 1,
      notification_property_delivery_windows: 1,
      notification_unsubscribe_scopes: 1,
    })
    expect(Object.values(actual).reduce((sum, n) => sum + n, 0)).toBe(
      Object.values(reported).reduce((sum, n) => sum + n, 0),
    )
    expect(sibling).toEqual(reported)
    expect(await heldRows(a.organizationId, a.otherPropertyId)).toEqual(sibling)
    expect(await heldRows(b.organizationId, b.propertyId)).toEqual(otherTenant)
  })

  it('reports the rows an Organization purge removes, per table, and not another tenant', async () => {
    const a = await seedTenant()
    const b = await seedTenant()
    const reported = await heldRows(a.organizationId)
    const otherTenant = await heldRows(b.organizationId)
    const before = await countsOf(a.organizationId)

    await purgeNotificationRightsData(db, { organizationId: a.organizationId }, 50)

    const actual = removed(before, await countsOf(a.organizationId))
    expect(reported).toEqual(actual)
    expect(reported).toEqual(BEFORE)
    expect(otherTenant).toEqual(BEFORE)
    expect(await heldRows(b.organizationId)).toEqual(otherTenant)
    expect(await heldRows(a.organizationId)).toEqual(
      Object.fromEntries(Object.keys(BEFORE).map((table) => [table, 0])),
    )
  })

  const authorizer = (adminIds: readonly string[]) =>
    createNotificationAudienceAuthorizer({
      userLookup: { findByRole: async () => adminIds.map(brandUser) },
      organizationAccountAuthority: createOrganizationAccountNotificationAuthority(db),
    } as unknown as Parameters<typeof createNotificationAudienceAuthorizer>[0])

  const noticeWriterFor = (adminIds: readonly string[]) =>
    createNoticeWriter({
      db,
      clock: () => new Date(),
      idGen: () => notificationId(randomUUID()),
      emailIdGen: () => notificationEmailId(randomUUID()),
      logger: currentRouteDeps().logger as never,
      ratingForRouting: async () => null,
      authorizeAudience: authorizer(adminIds),
      workState: waitingWorkState(),
    })

  const finalWarningRows = async (organizationId: string) =>
    (
      await lease.pool.query(
        `SELECT user_id, property_id, event_id, payload, coalesced_count
           FROM notifications
          WHERE organization_id = $1 AND type = 'account.organization_purge_pending'`,
        [organizationId],
      )
    ).rows

  it('delivers a manual final warning to a former member with no role, once', async () => {
    const a = await seedTenant()
    const b = await seedTenant()
    const sent: ManualFinalWarning[] = []
    const writer = noticeWriterFor([a.adminId])
    const port = createNotificationRightsPort(db, {
      writeDirect: async (warning) => {
        sent.push({ eventId: warning.eventId, notices: warning.notices })
        return writer.writeDirect(warning)
      },
    })
    const request = {
      scope: 'organization',
      mode: 'apply',
      organizationId: a.organizationId,
      batchSize: 50,
      finalWarning: true,
      requestRef: 'ticket:9',
    } as const

    const result = await runNotificationRights(port, request)
    expect(result.lines).toEqual(['final warnings queued: 1'])
    // The seeded admin holds no member row here, so the lookup finds nobody:
    // only the former member is written, found through the removal notice.
    expect(sent).toHaveLength(1)
    const rows = await finalWarningRows(a.organizationId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      user_id: a.userId,
      property_id: null,
      event_id: `manual-final-warning:${a.organizationId}:ticket:9`,
      payload: { organizationName: a.organizationName },
      coalesced_count: 1,
    })
    expect(await finalWarningRows(b.organizationId)).toEqual([])
    const emails = await count('notification_email_queue', a.organizationId)

    // The same request again folds into the waiting notice: no second row,
    // no second email.
    await runNotificationRights(port, request)
    expect(await finalWarningRows(a.organizationId)).toHaveLength(1)
    expect(await count('notification_email_queue', a.organizationId)).toBe(emails)

    const decide = authorizer([a.adminId])
    const former = sent[0]!.notices.find(
      (notice) => notice.userId === brandUser(a.userId),
    )
    expect(former).toBeDefined()
    const formerInput = {
      userId: brandUser(a.userId),
      organizationId: brandOrganization(a.organizationId),
      propertyId: null,
      audience: former!.audience,
    }
    expect(await decide(formerInput)).toBe(true)

    // The same audience refuses another person and another Organization.
    expect(await decide({ ...formerInput, userId: brandUser(a.adminId) })).toBe(false)
    expect(
      await decide({
        ...formerInput,
        organizationId: brandOrganization(b.organizationId),
      }),
    ).toBe(false)

    // A current AccountAdmin is admitted by the role, with no Property.
    const [adminNotice] = buildManualFinalWarning({
      organizationId: a.organizationId,
      requestRef: 'ticket:9',
      payload: { organizationName: a.organizationName },
      accountAdmins: [a.adminId],
      formerMembers: [],
    }).notices
    expect(
      await decide({
        ...formerInput,
        userId: brandUser(a.adminId),
        audience: adminNotice!.audience,
      }),
    ).toBe(true)
  })

  it('sends final warnings through the rights-request script for two tenants', async () => {
    const a = await seedTenant()
    const b = await seedTenant()

    const finalWarning = (tenant: Tenant) =>
      runRights(tenant.organizationId, [
        'organization',
        'final-warning',
        ...applyTokens('closure'),
        `confirm=ERASE ORGANIZATION ${tenant.organizationId}`,
      ])
    const runs = [await finalWarning(a), await finalWarning(b)]

    for (const [index, tenant] of [a, b].entries()) {
      expect(runs[index]!.code).toBe(0)
      const notices = runs[index]!.sent.flatMap((w) => w.notices)
      expect(notices.map((notice) => notice.userId)).toEqual([tenant.userId])
      expect(notices[0]?.organizationId).toBe(tenant.organizationId)
      expect(notices[0]?.payload).toEqual({ organizationName: tenant.organizationName })
    }
    expect(await count('notifications', a.organizationId)).toBe(3)
  })
  describe('isolation between Properties and Organizations', () => {
    it('reports the counts of each tenant and Property', async () => {
      const a = await seedTenant()
      const other = await seedTenant()

      const org = await runRights(a.organizationId, ['access'])
      const property = await runRights(a.organizationId, [
        'property',
        '--property',
        a.propertyId,
      ])
      const otherOrg = await runRights(other.organizationId, ['access'])

      expect(org.out).toEqual(
        expect.arrayContaining([
          'notification: notifications: 3',
          'notification: preferences: 2',
          'notification: user settings: 1',
        ]),
      )
      expect(property.out).toEqual(
        expect.arrayContaining([
          'notification: notifications: 1',
          'notification: preferences: 1',
          'notification: user settings: 0',
        ]),
      )
      expect(otherOrg.out).toEqual(
        expect.arrayContaining([
          'notification: notifications: 3',
          'notification: preferences: 2',
        ]),
      )
    })

    it('erases Property A and leaves Property B and the other Organization byte-identical', async () => {
      const a = await seedTenant()
      const other = await seedTenant()
      const before = await dumpOrganization(a.organizationId)
      const otherBefore = await dumpOrganization(other.organizationId)

      const result = await runRights(a.organizationId, propertyApply(a.propertyId))

      expect(result.code).toBe(0)
      const after = await dumpOrganization(a.organizationId)
      expect(rowTotal(after)).toBeLessThan(rowTotal(before))
      expect(canonical(outsideProperty(after, a.propertyId))).toBe(canonical(after))
      expect(canonical(after)).toBe(canonical(outsideProperty(before, a.propertyId)))
      expect(
        (after.notifications ?? []).some((row) => row.property_id === a.otherPropertyId),
      ).toBe(true)
      expect(canonical(await dumpOrganization(other.organizationId))).toBe(
        canonical(otherBefore),
      )
    })

    it('erases an Organization and leaves the other Organization byte-identical', async () => {
      const a = await seedTenant()
      const other = await seedTenant()
      const otherBefore = await dumpOrganization(other.organizationId)

      const result = await runRights(
        a.organizationId,
        organizationApply(a.organizationId),
      )

      expect(result.code).toBe(0)
      expect(rowTotal(await dumpOrganization(a.organizationId))).toBe(0)
      expect(canonical(await dumpOrganization(other.organizationId))).toBe(
        canonical(otherBefore),
      )
    })

    it('erases Property A again when a restore brings it back and the fence replays the journal', async () => {
      const a = await seedTenant()
      const other = await seedTenant()
      const before = await dumpOrganization(a.organizationId)
      const otherBefore = await dumpOrganization(other.organizationId)
      const { puts, journal } = capturingJournal()

      const result = await runRights(
        a.organizationId,
        propertyApply(a.propertyId),
        journal,
      )
      expect(result.code).toBe(0)
      expect(puts).toHaveLength(1)
      const survivors = await dumpOrganization(a.organizationId)

      await restoreRows(before)
      expect(canonical(await dumpOrganization(a.organizationId))).toBe(canonical(before))

      const replay = await replayThroughFence(puts[0]!)

      expect(replay.verified).toBe(true)
      expect(replay.counts.ledgerEntriesReapplied).toBe(1)
      expect(replay.counts.ledgerRowsReErased).toBeGreaterThan(0)
      expect(canonical(await dumpOrganization(a.organizationId))).toBe(
        canonical(survivors),
      )
      expect(canonical(await dumpOrganization(other.organizationId))).toBe(
        canonical(otherBefore),
      )
    })

    it('erases an Organization again when the fence replays its journal entry', async () => {
      const a = await seedTenant()
      const other = await seedTenant()
      const before = await dumpOrganization(a.organizationId)
      const otherBefore = await dumpOrganization(other.organizationId)
      const { puts, journal } = capturingJournal()

      expect(
        (await runRights(a.organizationId, organizationApply(a.organizationId), journal))
          .code,
      ).toBe(0)
      await restoreRows(before)
      expect(rowTotal(await dumpOrganization(a.organizationId))).toBe(rowTotal(before))

      const replay = await replayThroughFence(puts[0]!)

      expect(replay.verified).toBe(true)
      expect(rowTotal(await dumpOrganization(a.organizationId))).toBe(0)
      expect(canonical(await dumpOrganization(other.organizationId))).toBe(
        canonical(otherBefore),
      )
    })

    it('does not erase when the journal write fails, and raises the alert', async () => {
      const a = await seedTenant()
      const other = await seedTenant()
      const before = await dumpOrganization(a.organizationId)
      const otherBefore = await dumpOrganization(other.organizationId)
      const alert = vi.fn()
      const journal = createRightsJournal({
        put: async () => {
          throw new Error('bucket unavailable')
        },
        alert,
      })

      for (const argv of [
        propertyApply(a.propertyId),
        organizationApply(a.organizationId),
      ]) {
        const result = await runRights(a.organizationId, argv, journal)
        expect(result.code).not.toBe(0)
      }

      expect(alert).toHaveBeenCalledTimes(2)
      expect(canonical(await dumpOrganization(a.organizationId))).toBe(canonical(before))
      expect(canonical(await dumpOrganization(other.organizationId))).toBe(
        canonical(otherBefore),
      )
    })

    it('refuses a final warning for a Property before touching any row', async () => {
      const a = await seedTenant()
      const before = await dumpOrganization(a.organizationId)

      const result = await runRights(a.organizationId, [
        'property',
        '--property',
        a.propertyId,
        'final-warning',
        ...APPLY_TOKENS,
        `confirm=ERASE PROPERTY ${a.propertyId}`,
      ])

      expect(result.code).toBe(1)
      expect(result.err.join('\n')).toContain(
        'Final warnings are sent for an Organization, not a Property',
      )
      expect(result.sent).toEqual([])
      expect(canonical(await dumpOrganization(a.organizationId))).toBe(canonical(before))
    })
  })
})
