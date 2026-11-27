import { NOTIFICATION_RIGHTS_TABLES } from '../domain/notification-rights-tables'
import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import type { Database } from '#/shared/db'
import type { TestLease } from '#/shared/testing/test-environment-lease'
import { createNotificationRightsReplayers } from './replayer.server'
import {
  createNotificationRightsPort,
  runNotificationRights,
  type FinalWarningWriter,
  type ManualFinalWarning,
} from './executor.server'
import {
  parseOperatorArgs,
  type OperatorContext,
  type OperatorIO,
} from '#/shared/ops/operator-command'
import { rightsRequestCommandSpec } from '#/shared/ops/rights/rights-request-command'
import { createNotificationRightsExecutor } from '#/shared/ops/rights/notification-rights-executor'
import { handleRightsRequest } from '#/shared/ops/rights/run-rights-request'
import { createRightsJournal } from '#/shared/ops/rights/rights-journal'
import { canonicalizeRfc8785 } from '#/shared/json/canonical-json'
import { applyRestoreResurrectionFence } from '#/shared/db/lifecycle/backup-erasure-ledger'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import type { Tx } from '#/shared/outbox/commit'

// Shared setup for the notification rights suites: a seeded tenant, row dumps
// that compare byte for byte, and the rights-request script run in process.

/** A writer for runs that only report, or that check what a run asked to send. */
export const recordingWriter = (sent: ManualFinalWarning[] = []): FinalWarningWriter => ({
  writeDirect: async ({ eventId, notices }) => {
    sent.push({ eventId, notices })
    return 'applied'
  },
})

let lease: TestLease
let db: Database
/** Organizations seeded by the running test, for its cleanup. */
export const organizations = new Set<string>()

/** Points the helpers at the lease and database the suite acquired. */
export function bindRightsDatabase(boundLease: TestLease, boundDb: Database): void {
  lease = boundLease
  db = boundDb
}

export type Tenant = Readonly<{
  organizationId: string
  propertyId: string
  otherPropertyId: string
  userId: string
  adminId: string
  removalEventId: string
  organizationName: string
}>

export async function seedTenant(): Promise<Tenant> {
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

export const count = async (table: string, organizationId: string): Promise<number> =>
  Number(
    (
      await lease.pool.query(
        `SELECT count(*) AS n FROM ${table} WHERE organization_id = $1`,
        [organizationId],
      )
    ).rows[0].n,
  )

// Parents first, so a restore can re-insert in this order.
export const RIGHTS_TABLES = [
  'notification_digest_batches',
  'notifications',
  'notification_email_queue',
  'notification_digest_batch_members',
  'notification_preferences',
  'notification_property_delivery_windows',
  'notification_user_settings',
  'notification_unsubscribe_scopes',
] as const

export type RowDump = Readonly<Record<string, readonly Record<string, unknown>[]>>

/** Every notification row of the Organization, as JSON, in a stable order. */
export async function dumpOrganization(organizationId: string): Promise<RowDump> {
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

export const canonical = (dump: RowDump): string => canonicalizeRfc8785(dump)

/** The rows that do not belong to the Property, digest members included. */
export function outsideProperty(dump: RowDump, propertyId: string): RowDump {
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

export async function restoreRows(dump: RowDump): Promise<void> {
  for (const table of RIGHTS_TABLES) {
    await lease.pool.query(
      `INSERT INTO ${table}
         SELECT * FROM jsonb_populate_recordset(null::${table}, $1::jsonb)
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(dump[table] ?? [])],
    )
  }
}

export const rowTotal = (dump: RowDump): number =>
  Object.values(dump).reduce((sum, rows) => sum + rows.length, 0)

export const applyTokens = (reason: string) => [
  '--apply',
  '--reason',
  reason,
  '--ticket',
  'T-1',
  '--yes',
  'ops:rights-request',
  'verified=2026-11-01T10:00:00Z',
  'verification=ticket:123',
]

export const APPLY_TOKENS = applyTokens('r')

export async function runRights(
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
  const sent: ManualFinalWarning[] = []
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
              createNotificationRightsPort(db, recordingWriter(sent)),
              request,
            ),
        }),
      ],
    },
    ctx,
    parsed.args,
    io,
  )
  return { code, out, err, sent }
}

export const propertyApply = (propertyId: string) => [
  'property',
  '--property',
  propertyId,
  ...APPLY_TOKENS,
  `confirm=ERASE PROPERTY ${propertyId}`,
]

export const organizationApply = (organizationId: string) => [
  'organization',
  ...APPLY_TOKENS,
  `confirm=ERASE ORGANIZATION ${organizationId}`,
]

export function capturingJournal() {
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

export async function replayThroughFence(entryBytes: string) {
  const entry = decodeErasureJournalEntry(entryBytes)
  return db.transaction((raw) =>
    applyRestoreResurrectionFence(raw as unknown as Tx, {
      entries: [entry],
      restorePointAt: new Date(entry.effectiveErasureAt.getTime() - 60_000),
      replayers: createNotificationRightsReplayers(),
    }),
  )
}
