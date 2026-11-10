import { NOTIFICATION_RIGHTS_TABLES } from '../domain/notification-rights-tables'
import { randomUUID } from 'node:crypto'
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
import { createNotificationRightsReplayers } from './replayer.server'
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
import { createRightsJournal } from '#/shared/ops/rights/rights-journal'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { applyRestoreResurrectionFence } from '#/shared/db/lifecycle/backup-erasure-ledger'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import type { Tx } from '#/shared/outbox/commit'

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

// Parents first, so a restore can re-insert in this order.
const RIGHTS_TABLES = [
  'notification_digest_batches',
  'notifications',
  'notification_email_queue',
  'notification_digest_batch_members',
  'notification_preferences',
  'notification_category_defaults',
  'notification_property_delivery_windows',
  'notification_user_settings',
  'notification_unsubscribe_scopes',
] as const

type RowDump = Readonly<Record<string, readonly Record<string, unknown>[]>>

/** Every notification row of the Organization, as JSON, in a stable order. */
async function dumpOrganization(organizationId: string): Promise<RowDump> {
  return Object.fromEntries(
    await Promise.all(
      RIGHTS_TABLES.map(async (table) => {
        const result = await lease.pool.query(
          `SELECT to_jsonb(t) AS row FROM ${table} t
            WHERE organization_id = $1 ORDER BY to_jsonb(t)::text`,
          [organizationId],
        )
        return [table, result.rows.map((r) => r.row as Record<string, unknown>)] as const
      }),
    ),
  )
}

const canonical = (dump: RowDump): string => canonicalizeRfc8785(dump)

/** The rows that do not belong to the Property, digest members included. */
function outsideProperty(dump: RowDump, propertyId: string): RowDump {
  const propertyEmails = new Set(
    (dump.notification_email_queue ?? [])
      .filter((row) => row.property_id === propertyId)
      .map((row) => row.id),
  )
  return Object.fromEntries(
    Object.entries(dump).map(([table, rows]) => [
      table,
      rows.filter((row) =>
        table === 'notification_digest_batch_members'
          ? !propertyEmails.has(row.notification_email_id)
          : row.property_id !== propertyId,
      ),
    ]),
  )
}

async function restoreRows(dump: RowDump): Promise<void> {
  for (const table of RIGHTS_TABLES) {
    await lease.pool.query(
      `INSERT INTO ${table}
         SELECT * FROM jsonb_populate_recordset(null::${table}, $1::jsonb)
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(dump[table] ?? [])],
    )
  }
}

const rowTotal = (dump: RowDump): number =>
  Object.values(dump).reduce((sum, rows) => sum + rows.length, 0)

const APPLY_TOKENS = [
  '--apply',
  '--reason',
  'r',
  '--ticket',
  'T-1',
  '--yes',
  'ops:rights-request',
  'verified=2026-11-01T10:00:00Z',
  'verification=ticket:123',
]

async function runRights(
  organizationId: string,
  argv: readonly string[],
  journal = createRightsJournal({ put: async () => {}, alert: () => {} }),
) {
  const parsed = parseOperatorArgs(
    ['--operator', 'op', '--org', organizationId, ...argv],
    rightsRequestCommandSpec,
  )
  if (!parsed.ok) throw new Error(parsed.error)
  const ctx = {
    operatorId: 'op',
    correlationId: 'c',
    organizationId,
    propertyId: parsed.args.propertyId,
    dryRun: !parsed.args.apply,
    batchSize: parsed.args.batchSize,
  } as unknown as OperatorContext
  const out: string[] = []
  const err: string[] = []
  const enqueued: ManualFinalWarningJob[] = []
  const io: OperatorIO = { out: (l) => out.push(l), err: (l) => err.push(l) }
  const code = await handleRightsRequest(
    {
      readFile: async () => '',
      writeExportFile: async () => {},
      journal,
      auditWrite: async () => {},
      subjectRefusal: async () => null,
      executors: (finalWarning) => [
        createNotificationRightsExecutor({
          finalWarning,
          tables: NOTIFICATION_RIGHTS_TABLES,
          run: (request) =>
            runNotificationRights(
              createNotificationRightsPort(db, async (job) => {
                enqueued.push(job)
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
  return { code, out, err, enqueued }
}

const propertyApply = (propertyId: string) => [
  'property',
  '--property',
  propertyId,
  ...APPLY_TOKENS,
  `confirm=ERASE PROPERTY ${propertyId}`,
]

const organizationApply = (organizationId: string) => [
  'organization',
  ...APPLY_TOKENS,
  `confirm=ERASE ORGANIZATION ${organizationId}`,
]

function capturingJournal() {
  const puts: string[] = []
  const alert = vi.fn()
  return {
    puts,
    alert,
    journal: createRightsJournal({
      put: async (_key, bytes) => {
        puts.push(bytes)
      },
      alert,
    }),
  }
}

async function replayThroughFence(entryBytes: string) {
  const entry = decodeErasureJournalEntry(entryBytes)
  return db.transaction((raw) =>
    applyRestoreResurrectionFence(raw as unknown as Tx, {
      entries: [entry],
      restorePointAt: new Date(entry.effectiveErasureAt.getTime() - 60_000),
      replayers: createNotificationRightsReplayers(),
    }),
  )
}

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
    const port = createNotificationRightsPort(db, async () => {})
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
          readFile: async () => '',
          writeExportFile: async () => {},
          journal: createRightsJournal({ put: async () => {}, alert: () => {} }),
          auditWrite: async () => {},
          subjectRefusal: async () => null,
          executors: (finalWarning) => [
            createNotificationRightsExecutor({
              finalWarning,
              tables: NOTIFICATION_RIGHTS_TABLES,
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
      expect(result.enqueued).toEqual([])
      expect(canonical(await dumpOrganization(a.organizationId))).toBe(canonical(before))
    })
  })
})
