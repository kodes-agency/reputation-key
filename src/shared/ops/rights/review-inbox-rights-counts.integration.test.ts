// The Review and Inbox rights reports against real PostgreSQL. Every table the
// reports count is seeded for two Properties of one Organization and for a
// second Organization, then each reported number is compared with the rows the
// apply really removes or scrubs, counted here with SQL of its own.

import { reputationReplyScopeEffects } from '#/composition/reply-scope-effects'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { INBOX_RIGHTS_TABLES } from '#/shared/db/lifecycle/inbox-rights-store'
import { REVIEW_RIGHTS_TABLES } from '#/shared/db/lifecycle/review-rights-store'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { parseOperatorArgs, type OperatorContext } from '../operator-command'
import { runRightsExecutors } from './rights-executor'
import { createRightsJournal, type RightsJournalStore } from './rights-journal'
import { planRightsRequest, rightsRequestCommandSpec } from './rights-request-command'
import {
  createInboxRightsExecutor,
  createReviewRightsExecutor,
} from './review-inbox-rights-executors'
import {
  bindPool,
  cleanup,
  q,
  seedTenant,
  tenants,
} from '#/shared/testing/review-inbox-rights-counts-fixtures'

const NOW = new Date('2026-11-08T12:00:00.000Z')

let lease: TestLease
let db: Database

/**
 * How one table's rows in a scope are found, written without the report code.
 * `$1` is the Organization, `$2` the Property or null for the whole
 * Organization. A table the closure scrubs keeps its rows; `scrub` names the
 * key that survives and the test for a scrubbed row.
 */
type Probe = Readonly<{
  table: string
  where: string
  scrub?: Readonly<{ key: string; done: string }>
}>

const DIRECT = `t.organization_id = $1 AND ($2::text IS NULL OR t.property_id::text = $2)`
const PROPERTIES_OF_SCOPE = `(SELECT p.id::text FROM properties p
  WHERE p.organization_id = $1 AND ($2::text IS NULL OR p.id::text = $2))`
const TEMPLATES_OF_SCOPE = `(SELECT tpl.id FROM reply_templates tpl
  WHERE tpl.organization_id = $1 AND ($2::text IS NULL OR tpl.property_id::text = $2))`
const RUNS_OF_SCOPE = `(SELECT run.id FROM review_provider_snapshot_runs run
  WHERE run.organization_id = $1 AND ($2::text IS NULL OR run.property_id::text = $2))`
const ITEMS_OF_SCOPE = `(SELECT item.id FROM inbox_items item
  WHERE item.organization_id = $1 AND ($2::text IS NULL OR item.property_id = $2))`

const direct = (table: string): Probe => ({ table, where: DIRECT })
const ofItems = (table: string): Probe => ({
  table,
  where: `t.inbox_item_id IN ${ITEMS_OF_SCOPE}`,
})

const REVIEW_PROBES: ReadonlyArray<Probe> = [
  {
    table: 'reviews',
    where: DIRECT,
    scrub: {
      key: 't.id::text',
      done: `t.source_content_state <> 'active' AND t.text IS NULL`,
    },
  },
  {
    table: 'replies',
    where: `t.review_id IN (SELECT r.id FROM reviews r
      WHERE r.organization_id = $1 AND ($2::text IS NULL OR r.property_id::text = $2))`,
    scrub: { key: 't.id::text', done: `t.text = '' AND t.created_by IS NULL` },
  },
  direct('review_provider_snapshot_runs'),
  direct('review_provider_history_cutoffs'),
  direct('review_ai_analysis_heads'),
  direct('review_google_reputation_snapshot_facts'),
  { table: 'organization_reply_voices', where: `t.organization_id = $1` },
  direct('property_reply_voices'),
  direct('reply_templates'),
  {
    table: 'reply_template_visibility',
    where: `t.organization_id = $1 AND ($2::text IS NULL
      OR t.property_id::text = $2 OR t.template_id IN ${TEMPLATES_OF_SCOPE})`,
  },
  { table: 'reply_template_revisions', where: `t.template_id IN ${TEMPLATES_OF_SCOPE}` },
  {
    table: 'reply_template_wordings',
    where: `t.revision_id IN (SELECT rev.id FROM reply_template_revisions rev
      WHERE rev.template_id IN ${TEMPLATES_OF_SCOPE})`,
  },
  direct('reply_publication_attempts'),
  {
    table: 'material_review_revisions',
    where: DIRECT,
    scrub: {
      key: `t.review_id::text || ':' || t.revision`,
      done: `t.content_state <> 'active'`,
    },
  },
  direct('review_source_contents'),
  direct('review_source_observations'),
  direct('review_first_sightings'),
  direct('review_provider_subjects'),
  direct('review_ai_analysis_released_sequences'),
  direct('google_reply_observations'),
  direct('google_reply_observation_heads'),
  { table: 'review_provider_snapshot_members', where: `t.run_id IN ${RUNS_OF_SCOPE}` },
  { table: 'review_provider_deletion_candidates', where: `t.run_id IN ${RUNS_OF_SCOPE}` },
  { table: 'review_sync_runs', where: `t.property_id IN ${PROPERTIES_OF_SCOPE}` },
  { table: 'review_sync_state', where: `t.property_id IN ${PROPERTIES_OF_SCOPE}` },
  {
    table: 'idempotency_receipts',
    where: `t.scope = 'gbp_webhook'
      AND t.payload->>'resolvedPropertyId' IN ${PROPERTIES_OF_SCOPE}`,
  },
]

const INBOX_PROBES: ReadonlyArray<Probe> = [
  { table: 'inbox_items', where: `t.id IN ${ITEMS_OF_SCOPE}` },
  direct('inbox_handling_cycles'),
  ofItems('inbox_notes'),
  {
    table: 'inbox_response_target_organization_policies',
    where: `t.organization_id = $1`,
  },
  direct('inbox_private_feedback_target_property_overrides'),
  { table: 'inbox_user_views', where: `t.organization_id = $1` },
  ofItems('inbox_assignment_history'),
  ofItems('inbox_escalation_history'),
  ofItems('inbox_priority_history'),
  ofItems('inbox_handling_cycle_heads'),
  ofItems('inbox_handling_cycle_transitions'),
  ofItems('inbox_handling_cycle_response_targets'),
  ofItems('inbox_response_target_reminders'),
  ofItems('inbox_response_target_exclusions'),
  ofItems('inbox_feedback_handling_outcomes'),
]

const ROW_KEY = `md5(to_jsonb(t.*)::text)`

type Target = Readonly<{ organizationId: string; propertyId: string | null }>

/** The rows a scope holds in one table, as keys that survive the apply. */
async function keysOf(probe: Probe, target: Target): Promise<string[]> {
  const result = await q(
    `SELECT ${probe.scrub?.key ?? ROW_KEY} AS key FROM ${probe.table} t WHERE ${probe.where}`,
    probe.where.includes('$2')
      ? [target.organizationId, target.propertyId]
      : [target.organizationId],
  )
  return result.rows.map((row) => String(row.key))
}

/** Of the keys: how many rows remain, and how many of those were removed or scrubbed. */
async function effectOn(
  probe: Probe,
  keys: ReadonlyArray<string>,
): Promise<Readonly<{ present: number; changed: number }>> {
  const count = async (extra: string) =>
    Number(
      (
        await q(
          `SELECT count(*)::int AS count FROM ${probe.table} t
           WHERE ${probe.scrub?.key ?? ROW_KEY} = ANY($1::text[]) ${extra}`,
          [keys],
        )
      ).rows[0]?.count,
    )
  const present = await count('')
  return probe.scrub
    ? { present, changed: await count(`AND ${probe.scrub.done}`) }
    : { present, changed: keys.length - present }
}

async function schedulableReminders(target: Target): Promise<number> {
  const result = await q(
    `SELECT count(*)::int AS count FROM inbox_response_target_reminders t
     WHERE t.inbox_item_id IN ${ITEMS_OF_SCOPE}
       AND t.delivered_at IS NULL AND t.cancelled_at IS NULL`,
    [target.organizationId, target.propertyId],
  )
  return Number(result.rows[0]?.count)
}

function planFor(argv: string[]) {
  const parsed = parseOperatorArgs(
    ['--operator', 'op', ...argv],
    rightsRequestCommandSpec,
  )
  if (!parsed.ok) throw new Error(parsed.error)
  const ctx = {
    operatorId: 'op',
    correlationId: 'c',
    organizationId: parsed.args.organizationId,
    propertyId: parsed.args.propertyId,
    dryRun: !parsed.args.apply,
    batchSize: parsed.args.batchSize,
  } as unknown as OperatorContext
  return planRightsRequest(ctx, parsed.args)
}

const quietStore: RightsJournalStore = { put: async () => {}, alert: () => {} }

async function runScript(argv: string[]) {
  const planned = planFor(argv)
  const out: string[] = []
  const err: string[] = []
  if (!planned.ok) throw new Error(planned.error)
  const exit = await runRightsExecutors({
    plan: planned.plan,
    executors: [
      createReviewRightsExecutor({
        db,
        now: () => NOW,
        replyEffects: reputationReplyScopeEffects,
      }),
      createInboxRightsExecutor({ db, now: () => NOW }),
    ],
    journal: createRightsJournal(quietStore),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    writeExportFile: async () => {},
  })
  return { exit, out, err }
}

const scopeArgv = (target: Target) =>
  target.propertyId
    ? ['property', '--org', target.organizationId, '--property', target.propertyId]
    : ['organization', '--org', target.organizationId]

const applyArgv = (target: Target) => [
  ...scopeArgv(target),
  'verified=2026-11-01T10:00:00Z',
  'verification=ticket:123',
  '--reason',
  'erasure request',
  '--ticket',
  'T-1',
  target.propertyId
    ? `confirm=ERASE PROPERTY ${target.propertyId}`
    : `confirm=ERASE ORGANIZATION ${target.organizationId}`,
  '--apply',
  '--yes',
  'ops:rights-request',
]

/** `table=n` pairs of the report line that starts with `prefix`, in order. */
function reportedCounts(out: string[], prefix: string): Array<[string, number]> {
  const line = out.find((entry) => entry.startsWith(prefix))
  expect(line, prefix).toBeDefined()
  return [...(line ?? '').matchAll(/([a-z_]+)=(\d+)/g)].map(
    ([, name, value]) => [String(name), Number(value)] as [string, number],
  )
}

type Area = Readonly<{
  prefix: string
  tables: ReadonlyArray<string>
  probes: ReadonlyArray<Probe>
}>

const areas = (scope: 'organization' | 'property'): ReadonlyArray<Area> => [
  { prefix: 'review: ', tables: REVIEW_RIGHTS_TABLES[scope], probes: REVIEW_PROBES },
  { prefix: 'inbox: ', tables: INBOX_RIGHTS_TABLES[scope], probes: INBOX_PROBES },
]

type Snapshot = Readonly<{
  before: Map<string, string[]>
  keptBefore: Map<string, string[]>
}>

async function snapshotRows(
  scope: 'organization' | 'property',
  erasing: Target,
  kept: ReadonlyArray<Target>,
): Promise<Snapshot> {
  const before = new Map<string, string[]>()
  const keptBefore = new Map<string, string[]>()
  for (const area of areas(scope)) {
    expect(area.probes.map((probe) => probe.table).sort()).toEqual(
      [
        ...(area.prefix === 'review: ' ? REVIEW_RIGHTS_TABLES : INBOX_RIGHTS_TABLES)
          .organization,
      ].sort(),
    )
    for (const probe of area.probes) {
      const keys = await keysOf(probe, erasing)
      expect(keys.length, `${probe.table} is seeded`).toBeGreaterThan(0)
      before.set(probe.table, keys)
      for (const target of kept) {
        keptBefore.set(JSON.stringify([probe.table, target]), await keysOf(probe, target))
      }
    }
  }
  return { before, keptBefore }
}

function expectReportedCounts(
  scope: 'organization' | 'property',
  out: string[],
  before: Map<string, string[]>,
): Set<string> {
  const reportedTables = new Set<string>()
  for (const area of areas(scope)) {
    const counts = reportedCounts(out, area.prefix)
    expect(counts.map(([name]) => name)).toEqual(area.tables)
    for (const [table, count] of counts) {
      reportedTables.add(table)
      expect(count, `reported ${table}`).toBe(before.get(table)?.length)
    }
  }
  return reportedTables
}

async function expectKeptUntouched(
  probe: Probe,
  kept: ReadonlyArray<Target>,
  keptBefore: Map<string, string[]>,
): Promise<void> {
  for (const target of kept) {
    const keptKeys = keptBefore.get(JSON.stringify([probe.table, target])) ?? []
    expect(
      await effectOn(probe, keptKeys),
      `${probe.table} of ${JSON.stringify(target)}`,
    ).toEqual({ present: keptKeys.length, changed: 0 })
  }
}

async function expectErasedOrUntouched(
  probe: Probe,
  keys: string[],
  reported: boolean,
): Promise<void> {
  const effect = await effectOn(probe, keys)
  if (!reported) {
    // Left alone by this scope: present and unchanged.
    expect(effect, `${probe.table} untouched`).toEqual({
      present: keys.length,
      changed: 0,
    })
    return
  }
  expect(effect.changed, `${probe.table} removed or scrubbed`).toBe(keys.length)
  if (probe.scrub) expect(effect.present, `${probe.table} kept`).toBe(keys.length)
  else expect(effect.present, `${probe.table} gone`).toBe(0)
}

/**
 * Reports the erasing scope, applies it, and proves each reported number is
 * the rows the apply removed or scrubbed, and that nothing else moved.
 */
async function expectReportMatchesApply(
  erasing: Target,
  kept: ReadonlyArray<Target>,
): Promise<void> {
  const scope = erasing.propertyId ? 'property' : 'organization'
  const { before, keptBefore } = await snapshotRows(scope, erasing, kept)
  const reminders = await schedulableReminders(erasing)
  expect(reminders).toBeGreaterThan(0)

  const reported = await runScript(scopeArgv(erasing))
  expect(reported.exit).toBe(0)
  const reportedTables = expectReportedCounts(scope, reported.out, before)
  expect(reported.out).toContain(`inbox: schedulable reminders: ${reminders}`)

  const applied = await runScript(applyArgv(erasing))
  expect(applied.exit).toBe(0)

  for (const area of areas(scope)) {
    for (const probe of area.probes) {
      await expectKeptUntouched(probe, kept, keptBefore)
      await expectErasedOrUntouched(
        probe,
        before.get(probe.table) ?? [],
        reportedTables.has(probe.table),
      )
    }
  }
}

describe.sequential('Review and Inbox rights report counts', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    bindPool(lease.pool)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    for (const tenant of tenants) await cleanup(tenant)
    tenants.length = 0
  })

  it('owns and cleans up its provider key without changing the existing key inventory', async () => {
    const inventory = async () =>
      (
        await q(
          `SELECT * FROM review_provider_subject_hmac_key_versions ORDER BY key_version`,
        )
      ).rows
    const before = await inventory()
    const tenant = await seedTenant([2, 3])
    const subjects = await q(
      `SELECT DISTINCT key_version FROM review_provider_subjects WHERE organization_id = $1`,
      [tenant.organizationId],
    )

    expect(subjects.rows).toHaveLength(1)
    expect(before.map((row) => row.key_version)).not.toContain(
      subjects.rows[0]!.key_version,
    )
    expect(await inventory()).toHaveLength(before.length + 1)

    await cleanup(tenant)
    expect(await inventory()).toEqual(before)
  })

  it('counts, for an Organization, exactly the rows its apply removes or scrubs', async () => {
    const closing = await seedTenant([2, 3])
    const kept = await seedTenant([3, 2])

    await expectReportMatchesApply(
      { organizationId: closing.organizationId, propertyId: null },
      [{ organizationId: kept.organizationId, propertyId: null }],
    )
  })

  it('counts, for a Property, exactly the rows its apply removes or scrubs', async () => {
    const closing = await seedTenant([2, 3])
    const kept = await seedTenant([3, 2])
    const [first, second] = closing.propertyIds as [string, string]
    const organizationId = closing.organizationId

    await expectReportMatchesApply({ organizationId, propertyId: first }, [
      { organizationId, propertyId: second },
      { organizationId: kept.organizationId, propertyId: null },
    ])
    await expectReportMatchesApply({ organizationId, propertyId: second }, [
      { organizationId: kept.organizationId, propertyId: null },
    ])
  })
})
