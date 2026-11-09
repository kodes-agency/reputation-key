// The Portal rights executor against real PostgreSQL, driven the way
// scripts/ops/rights-request.ts drives it: parse, plan, run the executors.
// One Organization holds Property A and Property B and a second Organization
// is the control, so every case proves what stays untouched.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { applyRestoreResurrectionFence } from '#/shared/db/lifecycle/backup-erasure-ledger'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import { portalMediaObjectKey } from '#/shared/domain/portal-media'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { parseOperatorArgs, type OperatorContext } from '#/shared/ops/operator-command'
import { runRightsExecutors } from '#/shared/ops/rights/rights-executor'
import {
  createRightsJournal,
  type RightsJournalStore,
} from '#/shared/ops/rights/rights-journal'
import {
  planRightsRequest,
  rightsRequestCommandSpec,
} from '#/shared/ops/rights/rights-request-command'
import { PORTAL_PURGE_PLAN } from './portal-organization-lifecycle.adapter'
import {
  createPortalErasureReplayers,
  createPortalRightsExecutor,
} from './portal-rights.adapter'

const NOW = new Date('2026-11-08T12:00:00.000Z')
const OCCURRED_AT = new Date('2027-01-15T00:00:00.000Z')
const DIGEST = 'a'.repeat(64)

const organizations = new Set<string>()
let lease: TestLease
let db: Database
const objectStore = createInMemoryObjectStore()

type Tenant = Readonly<{
  organizationId: string
  a: Property
  b: Property
}>
type Property = Readonly<{
  propertyId: string
  portalId: string
  portalGroupId: string
  mediaAssetId: string
}>

async function seedProperty(organizationId: string): Promise<Property> {
  const propertyId = randomUUID()
  const fixture = {
    propertyId,
    portalId: randomUUID(),
    portalGroupId: randomUUID(),
    snapshotId: randomUUID(),
    activationId: randomUUID(),
    tokenId: randomUUID(),
    destinationId: randomUUID(),
  }
  const q = (text: string, values: readonly unknown[]) =>
    lease.pool.query(text, [...values])
  const scope = [organizationId, fixture.propertyId, fixture.portalId]
  const actor = `portal-rights-actor-${randomUUID()}`

  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1::uuid, $2, 'Harbour House', 'harbour-' || $1::text, 'UTC', now(), now())`,
    [fixture.propertyId, organizationId],
  )
  await q(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Ground floor', now(), now())`,
    [fixture.portalGroupId, organizationId, fixture.propertyId],
  )
  await q(
    `INSERT INTO portal_group_history (id, organization_id, property_id, portal_group_id,
                                       kind, name, actor_user_id, occurred_at)
     VALUES ($1, $2, $3, $4, 'created', 'Ground floor', $5, now())`,
    [randomUUID(), organizationId, fixture.propertyId, fixture.portalGroupId, actor],
  )
  await q(
    `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug,
                          publication_state, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'Front Desk', 'front-desk', 'published', now(), now())`,
    [fixture.portalId, organizationId, fixture.propertyId, fixture.propertyId],
  )
  await q(
    `INSERT INTO portal_group_members (id, portal_group_id, portal_id, organization_id, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [randomUUID(), fixture.portalGroupId, fixture.portalId, organizationId],
  )
  const mediaAssetId = randomUUID()
  await q(
    `INSERT INTO portal_media_assets (
       id, organization_id, property_id, purpose, object_key, content_type, width,
       height, byte_size, content_sha256, source_format, source_bytes,
       rights_confirmed_at, created_by
     ) VALUES ($1::uuid, $2, $3, 'hero', 'portal-media/' || $1::text || '.webp', 'image/webp',
               2400, 1600, 180000, repeat('a', 64), 'jpeg', 2500000, now(), $4)`,
    [mediaAssetId, organizationId, fixture.propertyId, actor],
  )
  await objectStore.putObject(
    portalMediaObjectKey(mediaAssetId),
    Buffer.from('image'),
    'image/webp',
  )
  await q(
    `INSERT INTO property_portal_brand_profiles (
       id, organization_id, property_id, display_name, primary_color,
       background_color, text_color, hero_asset_id, hero_focal_x, hero_focal_y,
       updated_by, created_at, updated_at
     ) VALUES ($1, $2, $3, 'Harbour House', '#112233', '#FFFFFF', '#000000', $5, 0.5, 0.5,
               $4, now(), now())`,
    [randomUUID(), organizationId, fixture.propertyId, actor, mediaAssetId],
  )
  await q(
    `INSERT INTO property_portal_brand_contents (
       id, organization_id, property_id, locale, title, short_description,
       updated_by, created_at, updated_at
     ) VALUES ($1, $2, $3, 'en', 'Harbour House', 'By the water', $4, now(), now())`,
    [randomUUID(), organizationId, fixture.propertyId, actor],
  )
  await q(
    `INSERT INTO portal_localized_overrides (
       id, organization_id, property_id, portal_id, locale, title, updated_by,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'en', 'Front Desk', $5, now(), now())`,
    [randomUUID(), ...scope, actor],
  )
  // The Portal's own look (ADR 0070): its own photo, which is the Property's
  // image, and its own colours. Both keys are RESTRICT, so the purge order is tested.
  await q(
    `INSERT INTO portal_look_overrides (
       id, organization_id, property_id, portal_id, photo_mode, hero_asset_id,
       hero_focal_x, hero_focal_y, hero_alt_texts, colours_mode, primary_color,
       background_mode, background_color, look_version, updated_by
     ) VALUES ($1, $2, $3, $4, 'own', $6, 0.5, 0.5, '{"en": "The harbour"}'::jsonb,
               'own', '#B8860B', 'auto', '#101820', 2, $5)`,
    [randomUUID(), ...scope, actor, mediaAssetId],
  )
  await q(
    `INSERT INTO portal_health_intervals (
       id, organization_id, property_id, portal_id, status, reason, source_version,
       effective_from, observed_at
     ) VALUES ($1, $2, $3, $4, 'healthy', 'destination_verified', 'v1', now(), now())`,
    [randomUUID(), ...scope],
  )
  await q(
    `INSERT INTO portal_approved_destinations (
       id, organization_id, property_id, normalized_uri, hostname, source_type,
       approval_state, validation_version, requested_by, approved_by, approved_at,
       last_validated_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'https://example.test/menu', 'example.test', 'custom',
               'approved', 'v1', $4, $4, now(), now(), now(), now())`,
    [fixture.destinationId, organizationId, fixture.propertyId, actor],
  )
  const categoryId = randomUUID()
  await q(
    `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key,
                                         created_at, updated_at)
     VALUES ($1, $2, $3, 'Explore', 'a', now(), now())`,
    [categoryId, fixture.portalId, organizationId],
  )
  const linkId = randomUUID()
  await q(
    `INSERT INTO portal_links (id, category_id, portal_id, organization_id, property_id,
                               label, destination_id, legacy_destination_state, sort_key,
                               image_asset_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'Menu', $6, 'migrated', 'a', $7, now(), now())`,
    [
      linkId,
      categoryId,
      fixture.portalId,
      organizationId,
      fixture.propertyId,
      fixture.destinationId,
      mediaAssetId,
    ],
  )
  await q(
    `INSERT INTO portal_link_texts (id, organization_id, property_id, portal_id, link_id,
                                    locale, label, line, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'en', 'Menu', 'Open all day', $6, now(), now())`,
    [randomUUID(), ...scope, linkId, actor],
  )
  await q(
    `INSERT INTO portal_responsible_managers (
       id, organization_id, property_id, portal_id, user_id, effective_from, created_by
     ) VALUES ($1, $2, $3, $4, $5, now(), $5)`,
    [randomUUID(), ...scope, actor],
  )
  await q(
    `INSERT INTO portal_tokens (id, organization_id, property_id, portal_id,
                                token_identifier, token_hash, version, status,
                                issued_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, 'active', now(), now())`,
    [
      fixture.tokenId,
      ...scope,
      randomUUID().replaceAll('-', '').slice(0, 24),
      randomUUID().replaceAll('-', '').padEnd(64, 'f').slice(0, 64),
    ],
  )
  await q(
    `INSERT INTO portal_access_artifacts (id, organization_id, property_id, portal_id,
                                          portal_token_id, channel, status, published_at)
     VALUES ($1, $2, $3, $4, $5, 'qr', 'published', now())`,
    [randomUUID(), ...scope, fixture.tokenId],
  )
  await q(
    `INSERT INTO portal_address_downloads (id, organization_id, property_id, portal_id,
                                           portal_token_id, downloaded_by, purpose,
                                           downloaded_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'download', now())`,
    [randomUUID(), ...scope, fixture.tokenId, actor],
  )
  await q(
    `INSERT INTO portal_publication_snapshots (
       id, organization_id, property_id, portal_id, version, configuration_digest,
       configuration, guest_locale, language_pack_version, private_feedback_threshold,
       destination_uri, destination_retrieved_at, destination_source_epoch,
       destination_profile_version, created_by, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 'en', 'guest-ui-en-v1', 3,
               'https://example.test/review', now(), 0, 1, $6, now())`,
    [fixture.snapshotId, ...scope, DIGEST, actor],
  )
  await q(
    `INSERT INTO portal_publication_activations (
       id, organization_id, property_id, portal_id, snapshot_id, activation_sequence,
       kind, activated_by, activated_at
     ) VALUES ($1, $2, $3, $4, $5, 1, 'publish', $6, $7)`,
    [
      fixture.activationId,
      ...scope,
      fixture.snapshotId,
      actor,
      new Date(OCCURRED_AT.getTime() - 86_400_000),
    ],
  )
  await q(
    `INSERT INTO portal_pending_content_changes (
       id, organization_id, property_id, portal_id, change_kind, change_key,
       source_version, changed_at
     ) VALUES ($1, $2, $3, $4, 'portal_links', 'all', 'v2', now())`,
    [randomUUID(), ...scope],
  )
  await q(
    `INSERT INTO portal_page_edits (
       id, organization_id, property_id, portal_id, change_kind, change_key,
       actor_user_id, occurred_at
     ) VALUES ($1, $2, $3, $4, 'portal_links', 'all', $5, now())`,
    [randomUUID(), ...scope, actor],
  )
  await q(
    `INSERT INTO portal_last_prints (
       portal_id, organization_id, property_id, piece, orientation, look, paper,
       printer, quantity, fill_spares, crop_marks, back_page, languages,
       call_to_action, printed_at
     ) VALUES ($3, $1, $2, 'tent', 'wide', 'paper', 'letter', 'my_printer', 10,
               false, false, false, '["en"]'::jsonb, 'how_did_we_do', now())`,
    scope,
  )
  await q(
    `INSERT INTO portal_print_wordings (
       portal_id, organization_id, property_id, call_to_action, updated_at
     ) VALUES ($3, $1, $2, 'how_was_stay', now())`,
    scope,
  )
  return {
    propertyId,
    portalId: fixture.portalId,
    portalGroupId: fixture.portalGroupId,
    mediaAssetId,
  }
}

async function seedTenant(): Promise<Tenant> {
  const organizationId = `portal-rights-org-${randomUUID()}`
  organizations.add(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Portal Rights Fixture', $1, now())`,
    [organizationId],
  )
  return {
    organizationId,
    a: await seedProperty(organizationId),
    b: await seedProperty(organizationId),
  }
}

/** A Property's rows in every plan table, as stable text. Keyed tables join through the Portal. */
const PROPERTY_ROWS = (table: string) => `
  SELECT to_jsonb(t.*)::text AS row FROM ${table} AS t
  WHERE t.organization_id = $1
    AND (to_jsonb(t.*)->>'property_id' = $2
      OR to_jsonb(t.*)->>'portal_id' = $3
      OR to_jsonb(t.*)->>'portal_group_id' = $4)
  ORDER BY 1`

async function propertyRows(
  organizationId: string,
  property: Property,
): Promise<ReadonlyArray<readonly [string, ReadonlyArray<string>]>> {
  const out: Array<readonly [string, ReadonlyArray<string>]> = []
  for (const table of PORTAL_PURGE_PLAN) {
    const result = await lease.pool.query(PROPERTY_ROWS(table), [
      organizationId,
      property.propertyId,
      property.portalId,
      property.portalGroupId,
    ])
    out.push([table, result.rows.map((row) => String(row.row))])
  }
  return out
}

const propertySnapshot = async (organizationId: string, property: Property) =>
  JSON.stringify(await propertyRows(organizationId, property))

const rowTotal = async (organizationId: string, property: Property) =>
  (await propertyRows(organizationId, property)).reduce(
    (sum, [, rows]) => sum + rows.length,
    0,
  )

async function organizationSnapshot(organizationId: string): Promise<string> {
  const parts: string[] = []
  for (const table of PORTAL_PURGE_PLAN) {
    const result = await lease.pool.query(
      `SELECT to_jsonb(t.*)::text AS row FROM ${table} AS t
       WHERE t.organization_id = $1 ORDER BY 1`,
      [organizationId],
    )
    parts.push(`${table}:${result.rows.map((row) => String(row.row)).join('|')}`)
  }
  return parts.join('\n')
}

/** Puts a restore back: every captured row, parents first, existing rows kept. */
async function restoreRows(
  captured: ReadonlyArray<readonly [string, ReadonlyArray<string>]>,
): Promise<void> {
  for (const [table, rows] of [...captured].reverse()) {
    if (rows.length === 0) continue
    await lease.pool.query(
      `INSERT INTO ${table}
       SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)
       ON CONFLICT DO NOTHING`,
      [`[${rows.join(',')}]`],
    )
  }
}

async function hold(organizationId: string): Promise<void> {
  const lineage = randomUUID()
  const at = new Date()
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closure_requested', revision = revision + 1,
         closure_lineage_id = $2, closure_requested_at = $3,
         recoverable_until = $4, reactivation_required = true,
         requested_by = 'admin:rights-test', request_reason_code = 'test_workspace',
         request_support_evidence_ref = 'test:closure-request',
         last_transition_at = $3, last_actor_id = 'admin:rights-test',
         last_reason_code = 'test_workspace', last_support_evidence_ref = 'test:closure-request'
     WHERE organization_id = $1`,
    [organizationId, lineage, at, new Date(at.getTime() + 30 * 86_400_000)],
  )
  for (const [next, reason] of [
    ['closing', 'closing_prepared'],
    ['purge_pending', 'recovery_window_elapsed'],
  ] as const) {
    await lease.pool.query(
      `UPDATE organization_lifecycle_authority
       SET state = $2, revision = revision + 1,
           last_transition_at = $3, last_actor_id = 'system:rights-test',
           last_reason_code = $4, last_support_evidence_ref = 'test:advance'
       WHERE organization_id = $1`,
      [organizationId, next, at, reason],
    )
  }
}

async function takeOffTheAir(organizationId: string): Promise<void> {
  await lease.pool.query(
    `UPDATE portal_publication_activations
     SET deactivated_at = GREATEST(activated_at, $2), deactivation_reason = 'disabled'
     WHERE organization_id = $1 AND deactivated_at IS NULL`,
    [organizationId, OCCURRED_AT],
  )
}

function journalStore(): {
  store: RightsJournalStore
  puts: Map<string, string>
  alerts: unknown[]
} {
  const puts = new Map<string, string>()
  const alerts: unknown[] = []
  return {
    puts,
    alerts,
    store: {
      put: async (key, bytes) => {
        puts.set(key, bytes)
      },
      alert: (input) => {
        alerts.push(input)
      },
    },
  }
}

/** What scripts/ops/rights-request.ts does after the operator harness. */
async function runScript(argv: string[], journalStoreOverride?: RightsJournalStore) {
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
  const planned = planRightsRequest(ctx, parsed.args, { production: false })
  const out: string[] = []
  const err: string[] = []
  const files = new Map<string, string>()
  if (!planned.ok) return { exit: 1, out, err: [planned.error], files }
  // Export snapshots use PostgreSQL's clock and must follow the request within 15 minutes.
  const clock = await lease.pool.query<{ now: Date }>('SELECT now() AS now')
  const requestTime = clock.rows[0]!.now
  const exit = await runRightsExecutors({
    plan: planned.plan,
    executors: [createPortalRightsExecutor({ db, objectStore, now: () => requestTime })],
    journal: createRightsJournal(
      journalStoreOverride ?? { put: async () => {}, alert: () => {} },
    ),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    writeExportFile: async (path, bytes) => {
      files.set(path, Buffer.from(bytes).toString('utf8'))
    },
  })
  return { exit, out, err, files }
}

const VERIFIED = ['verified=2026-11-01T10:00:00Z', 'verification=ticket:123']

const propertyArgs = (organizationId: string, property: Property, apply: boolean) => [
  'property',
  '--org',
  organizationId,
  '--property',
  property.propertyId,
  ...(apply
    ? [
        ...VERIFIED,
        '--reason',
        'erasure request',
        '--ticket',
        'T-4',
        `confirm=ERASE PROPERTY ${property.propertyId}`,
        '--apply',
        '--yes',
        'ops:rights-request',
      ]
    : []),
]

const organizationArgs = (organizationId: string, apply: boolean) => [
  'organization',
  '--org',
  organizationId,
  ...(apply
    ? [
        ...VERIFIED,
        '--reason',
        'closure request',
        '--ticket',
        'T-1',
        `confirm=ERASE ORGANIZATION ${organizationId}`,
        '--apply',
        '--yes',
        'ops:rights-request',
      ]
    : []),
]

const CLEANUP_ORDER = ['work_items', ...PORTAL_PURGE_PLAN, 'properties'] as const

const storedKeys = () => [...objectStore.objects().keys()]
const keyOf = (property: Property) => portalMediaObjectKey(property.mediaAssetId)

describe.sequential('Portal rights executor through the rights-request command', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    for (const key of storedKeys()) await objectStore.deleteObject(key)
    const ids = [...organizations]
    for (const table of CLEANUP_ORDER) {
      await lease.pool.query(
        `DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`,
        [ids],
      )
    }
    await deleteTestOrganizations(lease.pool, ids)
    organizations.clear()
  })

  it('reports the counts of each Property and of the Organization', async () => {
    const tenant = await seedTenant()
    const other = await seedTenant()

    for (const property of [tenant.a, tenant.b]) {
      const report = await runScript(propertyArgs(tenant.organizationId, property, false))
      expect(report.exit).toBe(0)
      expect(report.out).toContain('portal: portals 1')
      expect(report.out).toContain('portal: portal_link_categories 1')
      expect(report.out).toContain('portal: portal_media_assets 1')
    }
    const org = await runScript(organizationArgs(tenant.organizationId, false))
    expect(org.exit).toBe(0)
    expect(org.out).toContain('portal: portals 2')
    expect(org.out).toContain('portal: portal_group_members 2')
    expect(other.organizationId).not.toBe(tenant.organizationId)
  })

  it('exports the Portal data of an Organization and nothing of the other one', async () => {
    const tenant = await seedTenant()
    const other = await seedTenant()

    const report = await runScript([
      ...organizationArgs(tenant.organizationId, false),
      'out=/x',
    ])

    expect(report.exit).toBe(0)
    const json = report.files.get('/x/portal/portals.json') ?? ''
    expect(json).toContain(tenant.a.portalId)
    expect(json).toContain(tenant.b.portalId)
    expect(json).not.toContain(other.a.portalId)
    expect(json).not.toContain('token_hash')
  })

  it('erases A, leaves B and the other Organization byte-identical, and replays a restore', async () => {
    const tenant = await seedTenant()
    const other = await seedTenant()
    const { organizationId } = tenant
    const bBefore = await propertySnapshot(organizationId, tenant.b)
    const otherBefore = await organizationSnapshot(other.organizationId)
    const restoreSet = await propertyRows(organizationId, tenant.a)
    const aBefore = await propertySnapshot(organizationId, tenant.a)
    const journal = journalStore()

    const result = await runScript(
      propertyArgs(organizationId, tenant.a, true),
      journal.store,
    )

    expect(result.err).toEqual([])
    expect(result.exit).toBe(0)
    expect(await rowTotal(organizationId, tenant.a)).toBe(0)
    expect(storedKeys()).not.toContain(keyOf(tenant.a))
    expect(storedKeys()).toContain(keyOf(tenant.b))
    expect(await propertySnapshot(organizationId, tenant.b)).toBe(bBefore)
    expect(await organizationSnapshot(other.organizationId)).toBe(otherBefore)

    const entries = [...journal.puts.values()].map(decodeErasureJournalEntry)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      context: 'portal',
      subjectClass: 'property',
      propertyId: tenant.a.propertyId,
    })

    await restoreRows(restoreSet)
    expect(await propertySnapshot(organizationId, tenant.a)).toBe(aBefore)

    const fence = await db.transaction((tx) =>
      applyRestoreResurrectionFence(tx, {
        entries,
        restorePointAt: new Date(NOW.getTime() - 86_400_000),
        replayers: createPortalErasureReplayers(),
      }),
    )

    expect(fence.verified).toBe(true)
    expect(fence.counts.ledgerEntriesReapplied).toBe(1)
    expect(fence.counts.ledgerRowsReErased).toBeGreaterThan(0)
    expect(await rowTotal(organizationId, tenant.a)).toBe(0)
    expect(await propertySnapshot(organizationId, tenant.b)).toBe(bBefore)
    expect(await organizationSnapshot(other.organizationId)).toBe(otherBefore)
  })

  it('erases a closing Organization and leaves the other Organization byte-identical', async () => {
    const tenant = await seedTenant()
    const other = await seedTenant()
    await takeOffTheAir(tenant.organizationId)
    await hold(tenant.organizationId)
    const otherBefore = await organizationSnapshot(other.organizationId)
    const journal = journalStore()

    const result = await runScript(
      organizationArgs(tenant.organizationId, true),
      journal.store,
    )

    expect(result.err).toEqual([])
    expect(result.exit).toBe(0)
    expect(await rowTotal(tenant.organizationId, tenant.a)).toBe(0)
    expect(await rowTotal(tenant.organizationId, tenant.b)).toBe(0)
    expect(storedKeys().sort()).toEqual([keyOf(other.a), keyOf(other.b)].sort())
    expect(await organizationSnapshot(other.organizationId)).toBe(otherBefore)
    expect(journal.puts.size).toBe(1)
  })

  it('refuses an active Organization and changes nothing', async () => {
    const tenant = await seedTenant()
    const before = await organizationSnapshot(tenant.organizationId)

    const result = await runScript(
      organizationArgs(tenant.organizationId, true),
      journalStore().store,
    )

    expect(result.exit).toBe(1)
    expect(result.err.join('\n')).toContain('nothing was changed')
    expect(await organizationSnapshot(tenant.organizationId)).toBe(before)
    expect(storedKeys()).toContain(keyOf(tenant.a))
  })

  it('changes nothing and raises the alert when the journal write is rejected', async () => {
    const tenant = await seedTenant()
    const other = await seedTenant()
    const before = [
      await organizationSnapshot(tenant.organizationId),
      await organizationSnapshot(other.organizationId),
    ]
    const keys = storedKeys().sort()
    const alerts: unknown[] = []

    const result = await runScript(propertyArgs(tenant.organizationId, tenant.a, true), {
      put: async () => {
        throw new Error('bucket unavailable')
      },
      alert: (input) => {
        alerts.push(input)
      },
    })

    expect(result.exit).not.toBe(0)
    expect(alerts).toHaveLength(1)
    expect(result.err.join('\n')).toContain('Erasure journal write failed')
    expect([
      await organizationSnapshot(tenant.organizationId),
      await organizationSnapshot(other.organizationId),
    ]).toEqual(before)
    expect(storedKeys().sort()).toEqual(keys)
  })
})
