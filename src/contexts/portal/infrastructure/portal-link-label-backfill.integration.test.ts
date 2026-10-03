// Migration 0052 against real PostgreSQL: before readers stop letting a newer
// `portal_links.label` beat the primary-language text, the wording they showed
// is copied into that text, once, with a History row. The migration is hand
// written SQL, so it is run here against rows seeded in the shape the window
// between migration 0044 and the text-aware editor could leave (a rename that
// moved the label and knew nothing of the text).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, portalId, propertyId, userId } from '#/shared/domain/ids'
import { portalCreated } from '../domain/events'
import { createAtomicPortalCommandStore } from './portal-command-store'

const ORG_A = organizationId('org-lblbf-0000-0000-000000000001')
const ORG_B = organizationId('org-lblbf-0000-0000-000000000002')
const PROPERTY_A = propertyId('9a100000-0000-4000-8000-000000000001')
const PORTAL_A = portalId('9b100000-0000-4000-8000-000000000001')
const CATEGORY = '9d100000-0000-4000-8000-000000000001'
const MANAGER = userId('manager-lblbf-0000000000000001')
const CREATED_AT = new Date('2026-09-01T10:00:00.000Z')
const TEXT_WRITTEN_AT = new Date('2026-09-02T10:00:00.000Z')
const RENAMED_AT = new Date('2026-09-03T10:00:00.000Z')

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MIGRATION_STATEMENTS = readFileSync(
  join(ROOT, 'drizzle', '0052_portal_link_label_backfill.sql'),
  'utf8',
)
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_pending_content_changes',
    'portal_link_texts',
    'portal_links',
    'portal_link_categories',
    'portal_approved_destinations',
    'portal_responsible_managers',
    'outbox_events',
    'portal_page_edits',
    'portals',
    'properties',
  ],
})

const linkId = (n: number): string =>
  `9c100000-0000-4000-8000-${String(n).padStart(12, '0')}`

const runMigration = async (): Promise<void> => {
  for (const statement of MIGRATION_STATEMENTS) await getPool().query(statement)
}

const insertLink = (n: number, label: string, updatedAt: Date) =>
  getPool().query(
    `INSERT INTO portal_links (id, category_id, portal_id, organization_id, property_id, label, url, sort_key, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'https://harbour.example.com/x', $7, $8, $9)`,
    [
      linkId(n),
      CATEGORY,
      PORTAL_A,
      ORG_A,
      PROPERTY_A,
      label,
      `a${n}`,
      CREATED_AT,
      updatedAt,
    ],
  )

const insertText = (
  n: number,
  locale: string,
  label: string,
  provenance: string | null = null,
) =>
  getPool().query(
    `INSERT INTO portal_link_texts (organization_id, property_id, portal_id, link_id, locale, label, provenance, version, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 2, 'user-before', $8, $8)`,
    [ORG_A, PROPERTY_A, PORTAL_A, linkId(n), locale, label, provenance, TEXT_WRITTEN_AT],
  )

const textsOf = async (n: number) =>
  (
    await getPool().query(
      `SELECT locale, label, provenance, version, updated_by, updated_at
         FROM portal_link_texts WHERE link_id = $1 ORDER BY locale`,
      [linkId(n)],
    )
  ).rows

const editsOf = async (n: number) =>
  (
    await getPool().query(
      `SELECT change_kind, change_key, previous_text, new_text, actor_user_id, occurred_at, portal_id
         FROM portal_page_edits WHERE organization_id = $1 AND change_key = $2`,
      [ORG_A, `link:${linkId(n)}:updated`],
    )
  ).rows

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  const portal = buildTestPortal({
    id: PORTAL_A,
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    entityId: PROPERTY_A,
    name: 'Reception',
    slug: 'reception',
    createdBy: MANAGER,
    primaryGuestLocale: 'en',
    additionalGuestLocales: ['bg'],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  })
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Harbour House', 'harbour-house', 'UTC', $3, $3)`,
    [PROPERTY_A, ORG_A, CREATED_AT],
  )
  await createAtomicPortalCommandStore(getDb()).createPortal({
    organizationId: ORG_A,
    portal,
    initialResponsibleManagerIds: [MANAGER],
    event: portalCreated({
      portalId: portal.id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      publicationState: portal.publicationState,
      sourceAggregateVersion: portal.updatedAt.toISOString(),
      occurredAt: portal.createdAt,
    }),
  })
  await getPool().query(
    `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key, created_at, updated_at)
     VALUES ($1, $2, $3, 'Links', 'a0', $4, $4)`,
    [CATEGORY, PORTAL_A, ORG_A, CREATED_AT],
  )
})

describe('migration 0052: the label a reader showed becomes the stored text', () => {
  it('copies a label renamed after its primary text into that text, with a History row', async () => {
    await insertLink(1, 'Sunset menu', RENAMED_AT)
    await insertText(1, 'en', 'Dinner menu', 'ai_draft')

    await runMigration()

    const [text] = await textsOf(1)
    expect(text).toMatchObject({
      locale: 'en',
      label: 'Sunset menu',
      provenance: null,
      version: 3,
      updated_by: 'system:migration-0052',
    })
    expect(text.updated_at.getTime()).toBeGreaterThan(RENAMED_AT.getTime())
    const edits = await editsOf(1)
    expect(edits).toHaveLength(1)
    expect(edits[0]).toMatchObject({
      change_kind: 'portal_links',
      previous_text: 'Dinner menu',
      new_text: 'Sunset menu',
      actor_user_id: null,
      portal_id: PORTAL_A,
    })
    expect(edits[0].occurred_at).toEqual(RENAMED_AT)
  })

  it('leaves every other link, text and the label column as they were', async () => {
    await insertLink(1, 'Same', RENAMED_AT)
    await insertText(1, 'en', 'Same')
    await insertLink(2, 'Older label', CREATED_AT)
    await insertText(2, 'en', 'Newer text')
    await insertLink(3, '', RENAMED_AT)
    await insertText(3, 'en', 'Named by its text')
    await insertLink(4, 'Renamed but not in the primary language', RENAMED_AT)
    await insertText(4, 'bg', 'Различно')
    await insertLink(5, 'No text row at all', RENAMED_AT)
    await insertLink(6, 'Only the other language is stale', RENAMED_AT)
    await insertText(6, 'en', 'Only the other language is stale')
    await insertText(6, 'bg', 'Старо')
    const before = await Promise.all([1, 2, 3, 4, 5, 6].map(textsOf))

    await runMigration()

    expect(await Promise.all([1, 2, 3, 4, 5, 6].map(textsOf))).toEqual(before)
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM portal_page_edits WHERE organization_id = $1`,
      [ORG_A],
    )
    expect(rows[0].n).toBe(0)
    const { rows: labels } = await getPool().query(
      `SELECT label FROM portal_links WHERE id = $1`,
      [linkId(2)],
    )
    expect(labels[0].label).toBe('Older label')
  })

  it('does not change what it already settled when it runs again', async () => {
    await insertLink(1, 'Sunset menu', RENAMED_AT)
    await insertText(1, 'en', 'Dinner menu')

    await runMigration()
    const once = await textsOf(1)
    await runMigration()

    expect(await textsOf(1)).toEqual(once)
    expect(await editsOf(1)).toHaveLength(1)
  })

  it('trims the label as migration 0044 did, and skips a label that is only spaces', async () => {
    await insertLink(1, '  Sunset menu  ', RENAMED_AT)
    await insertText(1, 'en', 'Dinner menu')
    await insertLink(2, '   ', RENAMED_AT)
    await insertText(2, 'en', 'Named by its text')

    await runMigration()

    expect((await textsOf(1))[0]).toMatchObject({ label: 'Sunset menu', version: 3 })
    expect((await textsOf(2))[0]).toMatchObject({
      label: 'Named by its text',
      version: 2,
    })
  })
})
