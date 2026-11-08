import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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
  buildManualFinalWarningJobs,
  createNotificationRightsPort,
  runNotificationRights,
  type ManualFinalWarningJob,
} from './executor.server'
import { createNotificationAudienceAuthorizer } from '../application/notification-audience'
import { parseNotificationAudience } from '../application/notification-audience'
import { createOrganizationAccountNotificationAuthority } from '../infrastructure/adapters/organization-account-notification-authority.adapter'
import {
  organizationId as brandOrganization,
  userId as brandUser,
} from '#/shared/domain/ids'
import {
  parseOperatorArgs,
  type OperatorContext,
  type OperatorIO,
} from '#/shared/ops/operator-command'
import { rightsRequestCommandSpec } from '#/shared/ops/rights/rights-request-command'
import { registerAllEventSchemas } from '#/shared/events/registry.server'
import { createNotificationRightsExecutor } from '#/shared/ops/rights/notification-rights-executor'
import { handleRightsRequest } from '#/shared/ops/rights/run-rights-request'

let lease: TestLease
let db: Database
const organizations = new Set<string>()

type Tenant = Readonly<{
  organizationId: string
  propertyId: string
  otherPropertyId: string
  userId: string
  adminId: string
  removalEventId: string
  organizationName: string
}>

async function seedTenant(): Promise<Tenant> {
  const suffix = randomUUID()
  const tenant: Tenant = {
    organizationId: `rights-org-${suffix}`,
    propertyId: randomUUID(),
    otherPropertyId: randomUUID(),
    userId: `rights-user-${suffix}`,
    adminId: `rights-admin-${suffix}`,
    removalEventId: randomUUID(),
    organizationName: `Rights Hotel ${suffix}`,
  }
  organizations.add(tenant.organizationId)
  const at = new Date(Date.now() - 60_000)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, $4)`,
    [tenant.organizationId, tenant.organizationName, `rights-${suffix}`, at],
  )
  await lease.pool.query(
    `INSERT INTO outbox_events (
       id, event_type, event_version, payload, organization_id, source_context,
       source_aggregate_id, created_at
     ) VALUES ($1, 'identity.member.removed', 1, $2, $3, 'identity', $4, $5)`,
    [
      tenant.removalEventId,
      JSON.stringify({
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        removedBy: tenant.adminId,
      }),
      tenant.organizationId,
      tenant.userId,
      at,
    ],
  )
  const emailIds: string[] = []
  for (const [propertyId, slug] of [
    [tenant.propertyId, 'one'],
    [tenant.otherPropertyId, 'two'],
  ] as const) {
    await lease.pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Rights Property', $3, 'Europe/Sofia')`,
      [propertyId, tenant.organizationId, `rights-${slug}-${suffix}`],
    )
    const notificationId = randomUUID()
    await lease.pool.query(
      `INSERT INTO notifications (
         id, user_id, organization_id, property_id, type, category, priority, status,
         resource_type, resource_id, event_id, title, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'review.created', 'workflow_collaboration', 'normal',
                 'unread', 'inbox_item', $5, $6, 'New review', $7, $7)`,
      [
        notificationId,
        tenant.userId,
        tenant.organizationId,
        propertyId,
        `item-${slug}`,
        `event-${slug}-${suffix}`,
        at,
      ],
    )
    await lease.pool.query(
      `INSERT INTO notification_preferences (
         id, user_id, organization_id, property_id, category, channel, enabled,
         cadence, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'workflow_collaboration', 'email', false, 'daily', $5, $5)`,
      [randomUUID(), tenant.userId, tenant.organizationId, propertyId, at],
    )
    const emailId = randomUUID()
    emailIds.push(emailId)
    await lease.pool.query(
      `INSERT INTO notification_email_queue (
         id, notification_id, user_id, organization_id, property_id, category,
         cadence, status, priority, idempotency_key, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'workflow_collaboration', 'daily', 'pending',
                 'normal', $6, $7, $7)`,
      [
        emailId,
        notificationId,
        tenant.userId,
        tenant.organizationId,
        propertyId,
        `key-${slug}-${suffix}`,
        at,
      ],
    )
    await lease.pool.query(
      `INSERT INTO notification_unsubscribe_scopes (
         target_kind, target_id, organization_id, user_id, property_id, category, created_at
       ) VALUES ('email', $1, $2, $3, $4, 'workflow_collaboration', $5)`,
      [emailId, tenant.organizationId, tenant.userId, propertyId, at],
    )
    await lease.pool.query(
      `INSERT INTO notification_property_delivery_windows (
         id, user_id, organization_id, property_id, urgent_bypass_enabled,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, false, $5, $5)`,
      [randomUUID(), tenant.userId, tenant.organizationId, propertyId, at],
    )
  }
  const batchId = randomUUID()
  await lease.pool.query(
    `INSERT INTO notification_digest_batches (
       id, organization_id, user_id, local_date, sequence, member_digest,
       content_digest, provider_idempotency_key, created_at, updated_at
     ) VALUES ($1, $2, $3, '2026-11-01', 1, $4, $4, $5, $6, $6)`,
    [
      batchId,
      tenant.organizationId,
      tenant.userId,
      'a'.repeat(64),
      `digest-${suffix}`,
      at,
    ],
  )
  for (const [sortIndex, emailId] of emailIds.entries()) {
    await lease.pool.query(
      `INSERT INTO notification_digest_batch_members (
         batch_id, organization_id, user_id, notification_email_id, sort_index, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [batchId, tenant.organizationId, tenant.userId, emailId, sortIndex, at],
    )
  }
  await lease.pool.query(
    `INSERT INTO notification_category_defaults (
       id, user_id, organization_id, category, channel, enabled, cadence,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'workflow_collaboration', 'email', false, 'daily', $4, $4)`,
    [randomUUID(), tenant.userId, tenant.organizationId, at],
  )
  await lease.pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, created_at, updated_at
     ) VALUES ($1, $2, $3, NULL, 'account.organization_access_removed', 'mandatory',
               'normal', 'unread', 'organization', $3, $4, 'Access removed', $5, $5)`,
    [randomUUID(), tenant.userId, tenant.organizationId, tenant.removalEventId, at],
  )
  await lease.pool.query(
    `INSERT INTO notification_user_settings (
       id, user_id, organization_id, locale, timezone, urgent_bypass_enabled,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'en', 'Europe/Sofia', true, $4, $4)`,
    [randomUUID(), tenant.userId, tenant.organizationId, at],
  )
  return tenant
}

const count = async (table: string, organizationId: string): Promise<number> =>
  Number(
    (
      await lease.pool.query(
        `SELECT count(*) AS n FROM ${table} WHERE organization_id = $1`,
        [organizationId],
      )
    ).rows[0].n,
  )

describe.sequential('Notification rights reads and purge', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
    registerAllEventSchemas()
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
    expect(Object.values(await countsOf(a.organizationId)).every((n) => n === 0)).toBe(
      true,
    )
    expect(await countsOf(b.organizationId)).toEqual(BEFORE)
    expect(
      await purgeNotificationRightsData(db, { organizationId: a.organizationId }, 1),
    ).toEqual(Object.fromEntries(Object.keys(BEFORE).map((t) => [t, 0])))
  })

  const authorizer = (adminIds: readonly string[]) =>
    createNotificationAudienceAuthorizer({
      userLookup: { findByRole: async () => adminIds.map(brandUser) },
      organizationAccountAuthority: createOrganizationAccountNotificationAuthority(db),
    } as unknown as Parameters<typeof createNotificationAudienceAuthorizer>[0])

  it('delivers a manual final warning to an admin and to a former member with no role', async () => {
    const a = await seedTenant()
    const b = await seedTenant()
    const enqueued: ManualFinalWarningJob[] = []
    const port = createNotificationRightsPort(db, async (job) => {
      enqueued.push(job)
    })

    const result = await runNotificationRights(port, {
      scope: 'organization',
      mode: 'apply',
      organizationId: a.organizationId,
      batchSize: 50,
      finalWarning: true,
      requestRef: 'ticket:9',
    })
    expect(result.lines).toEqual(['final warnings queued: 1'])
    // The seeded admin holds no member row here, so the lookup finds nobody:
    // only the former member is queued, found through the removal notice.
    const former = enqueued.find((job) => job.data.userId === a.userId)
    expect(former?.data.payload).toEqual({ organizationName: a.organizationName })
    expect(former?.data.propertyId).toBeNull()

    const decide = authorizer([a.adminId])
    const asJob = (
      job: ManualFinalWarningJob,
      userId: string,
      org = a.organizationId,
    ) => ({
      userId: brandUser(userId),
      organizationId: brandOrganization(org),
      propertyId: null,
      audience: parseNotificationAudience(job.data.audience),
    })
    const formerInput = asJob(former!, a.userId)
    expect(formerInput.audience).not.toBeNull()
    expect(await decide({ ...formerInput, audience: formerInput.audience! })).toBe(true)

    // The same audience refuses another person and another Organization.
    expect(
      await decide({
        ...formerInput,
        userId: brandUser(a.adminId),
        audience: formerInput.audience!,
      }),
    ).toBe(false)
    expect(
      await decide({
        ...formerInput,
        organizationId: brandOrganization(b.organizationId),
        audience: formerInput.audience!,
      }),
    ).toBe(false)

    // A current AccountAdmin is admitted by the role, with no Property.
    const [adminJob] = buildManualFinalWarningJobs({
      organizationId: a.organizationId,
      requestRef: 'ticket:9',
      payload: former!.data.payload,
      accountAdmins: [a.adminId],
      formerMembers: [],
    })
    const adminInput = asJob(adminJob!, a.adminId)
    expect(await decide({ ...adminInput, audience: adminInput.audience! })).toBe(true)
  })

  it('queues final warnings through the rights-request script for two tenants', async () => {
    const a = await seedTenant()
    const b = await seedTenant()
    const queues = new Map<string, ManualFinalWarningJob[]>()

    const run = async (tenant: Tenant) => {
      const jobs: ManualFinalWarningJob[] = []
      queues.set(tenant.organizationId, jobs)
      const argv = [
        '--operator',
        'op',
        '--org',
        tenant.organizationId,
        'organization',
        'final-warning',
        '--apply',
        '--reason',
        'closure',
        '--ticket',
        'T-1',
        '--yes',
        'ops:rights-request',
        'verified=2026-11-01T10:00:00Z',
        'verification=ticket:123',
        `confirm=ERASE ORGANIZATION ${tenant.organizationId}`,
      ]
      const parsed = parseOperatorArgs(argv, rightsRequestCommandSpec)
      if (!parsed.ok) throw new Error(parsed.error)
      const ctx = {
        operatorId: 'op',
        correlationId: 'c',
        organizationId: tenant.organizationId,
        dryRun: false,
        batchSize: parsed.args.batchSize,
      } as unknown as OperatorContext
      const out: string[] = []
      const io: OperatorIO = { out: (l) => out.push(l), err: (l) => out.push(l) }
      const code = await handleRightsRequest(
        {
          production: false,
          readFile: async () => '',
          writeExportFile: async () => {},
          executors: (finalWarning) => [
            createNotificationRightsExecutor({
              finalWarning,
              run: (request) =>
                runNotificationRights(
                  createNotificationRightsPort(db, async (job) => {
                    jobs.push(job)
                  }),
                  request,
                ),
            }),
          ],
        },
        ctx,
        parsed.args,
        io,
      )
      return { code, out }
    }

    expect((await run(a)).code).toBe(0)
    expect((await run(b)).code).toBe(0)
    for (const tenant of [a, b]) {
      const jobs = queues.get(tenant.organizationId) ?? []
      expect(jobs.map((job) => job.data.userId)).toEqual([tenant.userId])
      expect(jobs[0]?.data.organizationId).toBe(tenant.organizationId)
      expect(jobs[0]?.data.payload).toEqual({ organizationName: tenant.organizationName })
    }
    expect(await count('notifications', a.organizationId)).toBe(3)
  })
})
