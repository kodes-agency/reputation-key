// LIF-01 bullet 6: the Portal context's own Organization Export slice —
// Portals, locales, brand, snapshots, links, groups, artifacts and health.
//
// This is a cross-context adapter implementation, so it may import the
// contributor port it implements and nothing else from Identity (see
// src/contexts/CONTEXT.md "Dependency rules" and the port header).

import { sql, type SQL } from 'drizzle-orm'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
import type {
  OrganizationExportContributor,
  OrganizationExportEntry,
} from '#/contexts/identity/application/ports/organization-export-contributor.port'

type ExportScalar = string | number | boolean | null
type ExportRecord = Readonly<Record<string, ExportScalar>>

type PortalOrganizationExportPayload = Readonly<{
  version: 'portal-organization-export/v1'
  requestedAsOf: string
  snapshotBound: 'repeatable_read_within_15m_of_request'
  portals: readonly ExportRecord[]
  portalGroups: readonly ExportRecord[]
  portalGroupMembers: readonly ExportRecord[]
  linkCategories: readonly ExportRecord[]
  links: readonly ExportRecord[]
  approvedDestinations: readonly ExportRecord[]
  localizedOverrides: readonly ExportRecord[]
  brandProfiles: readonly ExportRecord[]
  brandContents: readonly ExportRecord[]
  publicationSnapshots: readonly ExportRecord[]
  publicationActivations: readonly ExportRecord[]
  pendingContentChanges: readonly ExportRecord[]
  responsibleManagers: readonly ExportRecord[]
  accessArtifacts: readonly ExportRecord[]
  healthIntervals: readonly ExportRecord[]
  excludedRecordClasses: readonly Readonly<{
    recordClass: string
    reasonCode: string
  }>[]
}>

const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

/**
 * Every deliberate Portal-context exclusion, named so a reviewer can audit the
 * decision instead of inferring it from a missing column.
 *
 * - `portal_tokens` holds the address token hash and the encrypted raw token.
 *   That is credential material; the tenant-visible fact — that a published QR
 *   or NFC artifact exists — is exported from `portal_access_artifacts`
 *   instead, without the token id that joins back to the secret.
 * - `portal_upload_issuances` is Portal upload, which is `safety_blocked`.
 *   Exporting its object keys would give the dark capability an observable
 *   product surface, so it stays out until the SAFE-01 activation record.
 * - Goals reference Portals but are owned and exported by the Goal
 *   contributor; a second copy would let one archive disagree with itself.
 */
const EXCLUDED_RECORD_CLASSES = Object.freeze([
  { recordClass: 'portal_address_tokens', reasonCode: 'security_secret_material' },
  {
    recordClass: 'portal_upload_issuances_and_object_keys',
    reasonCode: 'dark_capability_not_activated',
  },
  {
    recordClass: 'portal_workflow_outbox_facts',
    reasonCode: 'content_free_control_plane',
  },
  { recordClass: 'portal_scoped_goals', reasonCode: 'exported_by_goal_contributor' },
  {
    recordClass: 'guest_responses_and_qualified_scans',
    reasonCode: 'exported_by_guest_contributor',
  },
])

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`Portal export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  throw new Error(`Portal export field has an unsupported value: ${field}`)
}

function normalizeRows(rows: readonly Record<string, unknown>[]): ExportRecord[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([field, value]) => [field, normalizeScalar(value, field)]),
    ),
  )
}

async function readRows(
  snapshot: Parameters<Parameters<Database['transaction']>[0]>[0],
  query: SQL,
): Promise<ExportRecord[]> {
  const result = await snapshot.execute(query)
  return normalizeRows(result.rows as Record<string, unknown>[])
}

/** UTF-8 byte order, never the database or host locale collation. */
function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

/**
 * Ordering happens here rather than in SQL because `ORDER BY` on a text column
 * follows the database collation, which is a host-configuration input. The last
 * key is always a surrogate id so the order is total.
 */
function sortRecords(
  rows: readonly ExportRecord[],
  keys: readonly string[],
): ExportRecord[] {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const result = compareText(String(left[key] ?? ''), String(right[key] ?? ''))
      if (result !== 0) return result
    }
    return 0
  })
}

function csvField(value: ExportScalar | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function csvSummary(type: string, record: ExportRecord): readonly ExportScalar[] {
  return [
    type,
    record.id ?? '',
    record.property_id ?? '',
    record.portal_id ?? record.id ?? '',
    record.name ?? record.title ?? record.label ?? record.display_name ?? '',
    record.publication_state ?? record.status ?? record.approval_state ?? 'recorded',
    record.created_at ?? record.effective_from ?? record.activated_at ?? '',
    record.updated_at ?? record.effective_to ?? record.deactivated_at ?? '',
    canonicalizeRfc8785(record),
  ]
}

const CSV_HEADER = [
  'record_type',
  'record_id',
  'property_id',
  'portal_id',
  'label',
  'state',
  'created_at',
  'updated_at',
  'record_json',
]

function collectionsOf(
  payload: PortalOrganizationExportPayload,
): readonly [string, readonly ExportRecord[]][] {
  return [
    ['portal', payload.portals],
    ['portal_group', payload.portalGroups],
    ['portal_group_member', payload.portalGroupMembers],
    ['portal_link_category', payload.linkCategories],
    ['portal_link', payload.links],
    ['approved_destination', payload.approvedDestinations],
    ['portal_localized_override', payload.localizedOverrides],
    ['property_brand_profile', payload.brandProfiles],
    ['property_brand_content', payload.brandContents],
    ['publication_snapshot', payload.publicationSnapshots],
    ['publication_activation', payload.publicationActivations],
    ['pending_content_change', payload.pendingContentChanges],
    ['portal_responsible_manager', payload.responsibleManagers],
    ['access_artifact', payload.accessArtifacts],
    ['health_interval', payload.healthIntervals],
  ]
}

function csvEntry(payload: PortalOrganizationExportPayload): OrganizationExportEntry {
  const lines = [
    CSV_HEADER.join(','),
    ...collectionsOf(payload).flatMap(([type, records]) =>
      records.map((record) => csvSummary(type, record).map(csvField).join(',')),
    ),
  ]
  return {
    path: 'portal/portals.csv',
    mediaType: 'text/csv',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
  }
}

function jsonEntry(payload: PortalOrganizationExportPayload): OrganizationExportEntry {
  return {
    path: 'portal/portals.json',
    mediaType: 'application/json',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${canonicalizeRfc8785(payload)}\n`, 'utf8'),
  }
}

const TS = `AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`

/** `jsonb::text` is Postgres' own normalized rendering, so it is stable input. */
const utc = (column: string) => sql.raw(`to_char(${column} ${TS})`)

async function readPayload(
  db: Database,
  organizationId: string,
  asOf: Date,
): Promise<PortalOrganizationExportPayload> {
  return db.transaction(
    async (snapshot) => {
      const snapshotRows = await readRows(
        snapshot,
        sql`SELECT transaction_timestamp() AS snapshot_at`,
      )
      const snapshotAt = snapshotRows[0]?.snapshot_at
      if (typeof snapshotAt !== 'string') {
        throw new Error('Portal export snapshot clock is unavailable')
      }
      const snapshotTime = new Date(snapshotAt).getTime()
      const requestTime = asOf.getTime()
      if (
        Number.isNaN(requestTime) ||
        snapshotTime < requestTime ||
        snapshotTime - requestTime > MAX_SNAPSHOT_LAG_MS
      ) {
        throw new Error('Portal export snapshot window is unavailable')
      }

      const portals = await readRows(
        snapshot,
        sql`SELECT id::text AS id, property_id::text AS property_id, entity_type,
                   entity_id, name, slug, description, hero_image_url,
                   theme::text AS theme, private_feedback_threshold,
                   publication_state, created_by, responsible_manager_revision,
                   ${utc('responsibility_needed_since')} AS responsibility_needed_since,
                   primary_guest_locale,
                   additional_guest_locales::text AS additional_guest_locales,
                   ${utc('created_at')} AS created_at,
                   ${utc('updated_at')} AS updated_at,
                   ${utc('deleted_at')} AS deleted_at
            FROM portals WHERE organization_id = ${organizationId}`,
      )
      const portalGroups = await readRows(
        snapshot,
        sql`SELECT id::text AS id, property_id::text AS property_id, name, sort_key,
                   ${utc('created_at')} AS created_at,
                   ${utc('updated_at')} AS updated_at,
                   ${utc('deleted_at')} AS deleted_at
            FROM portal_groups WHERE organization_id = ${organizationId}`,
      )
      const portalGroupMembers = await readRows(
        snapshot,
        sql`SELECT id::text AS id, portal_group_id::text AS portal_group_id,
                   portal_id::text AS portal_id,
                   ${utc('created_at')} AS created_at
            FROM portal_group_members WHERE organization_id = ${organizationId}`,
      )
      const linkCategories = await readRows(
        snapshot,
        sql`SELECT id::text AS id, portal_id::text AS portal_id, title, sort_key,
                   ${utc('created_at')} AS created_at,
                   ${utc('updated_at')} AS updated_at
            FROM portal_link_categories WHERE organization_id = ${organizationId}`,
      )
      const links = await readRows(
        snapshot,
        sql`SELECT id::text AS id, portal_id::text AS portal_id,
                   property_id::text AS property_id, category_id::text AS category_id,
                   label, destination_id::text AS destination_id, url,
                   legacy_destination_state, icon_key, sort_key,
                   ${utc('created_at')} AS created_at,
                   ${utc('updated_at')} AS updated_at
            FROM portal_links WHERE organization_id = ${organizationId}`,
      )
      const approvedDestinations = await readRows(
        snapshot,
        sql`SELECT id::text AS id, property_id::text AS property_id, normalized_uri,
                   hostname, source_type, approval_state, validation_version,
                   requested_by, approved_by,
                   ${utc('approved_at')} AS approved_at,
                   ${utc('disabled_at')} AS disabled_at, disabled_reason,
                   ${utc('last_validated_at')} AS last_validated_at,
                   ${utc('created_at')} AS created_at,
                   ${utc('updated_at')} AS updated_at
            FROM portal_approved_destinations WHERE organization_id = ${organizationId}`,
      )
      const localizedOverrides = await readRows(
        snapshot,
        sql`SELECT id::text AS id, property_id::text AS property_id,
                   portal_id::text AS portal_id, locale, title, short_description,
                   hero_image_url, version, updated_by,
                   ${utc('created_at')} AS created_at,
                   ${utc('updated_at')} AS updated_at
            FROM portal_localized_overrides WHERE organization_id = ${organizationId}`,
      )
      const brandProfiles = await readRows(
        snapshot,
        sql`SELECT id::text AS id, property_id::text AS property_id, display_name,
                   logo_url, default_hero_image_url, primary_color, background_color,
                   text_color, version, updated_by,
                   ${utc('created_at')} AS created_at,
                   ${utc('updated_at')} AS updated_at
            FROM property_portal_brand_profiles
            WHERE organization_id = ${organizationId}`,
      )
      const brandContents = await readRows(
        snapshot,
        sql`SELECT id::text AS id, property_id::text AS property_id, locale, title,
                   short_description, version, updated_by,
                   ${utc('created_at')} AS created_at,
                   ${utc('updated_at')} AS updated_at
            FROM property_portal_brand_contents
            WHERE organization_id = ${organizationId}`,
      )
      const publicationSnapshots = await readRows(
        snapshot,
        sql`SELECT id::text AS id, property_id::text AS property_id,
                   portal_id::text AS portal_id, version, configuration_digest,
                   configuration::text AS configuration, guest_locale,
                   language_pack_version, locale_set::text AS locale_set,
                   language_pack_versions::text AS language_pack_versions,
                   localized_content::text AS localized_content, brand_profile_version,
                   private_feedback_threshold, contact_request_enabled,
                   contact_notice_id, contact_notice_version, contact_notice_digest,
                   contact_notice_locale, contact_request_purpose,
                   contact_retention_policy_version, destination_uri,
                   ${utc('destination_retrieved_at')} AS destination_retrieved_at,
                   destination_source_epoch, destination_profile_version, created_by,
                   ${utc('created_at')} AS created_at
            FROM portal_publication_snapshots WHERE organization_id = ${organizationId}`,
      )
      const publicationActivations = await readRows(
        snapshot,
        sql`SELECT id::text AS id, property_id::text AS property_id,
                   portal_id::text AS portal_id, snapshot_id::text AS snapshot_id,
                   activation_sequence, kind, activated_by,
                   ${utc('activated_at')} AS activated_at,
                   ${utc('deactivated_at')} AS deactivated_at, deactivation_reason
            FROM portal_publication_activations
            WHERE organization_id = ${organizationId}`,
      )
      const pendingContentChanges = await readRows(
        snapshot,
        sql`SELECT id::text AS id, property_id::text AS property_id,
                   portal_id::text AS portal_id, change_kind, change_key,
                   source_version, ${utc('changed_at')} AS changed_at,
                   resolved_snapshot_id::text AS resolved_snapshot_id,
                   ${utc('resolved_at')} AS resolved_at
            FROM portal_pending_content_changes
            WHERE organization_id = ${organizationId}`,
      )
      const responsibleManagers = await readRows(
        snapshot,
        sql`SELECT id::text AS id, property_id::text AS property_id,
                   portal_id::text AS portal_id, user_id,
                   ${utc('effective_from')} AS effective_from,
                   ${utc('effective_to')} AS effective_to, created_by, end_reason
            FROM portal_responsible_managers WHERE organization_id = ${organizationId}`,
      )
      // Metadata only: `portal_token_id` is deliberately not selected, because
      // it is the join key into the address-token secret material.
      const accessArtifacts = await readRows(
        snapshot,
        sql`SELECT id::text AS id, property_id::text AS property_id,
                   portal_id::text AS portal_id, channel, status,
                   ${utc('published_at')} AS published_at,
                   ${utc('retired_at')} AS retired_at
            FROM portal_access_artifacts WHERE organization_id = ${organizationId}`,
      )
      const healthIntervals = await readRows(
        snapshot,
        sql`SELECT id::text AS id, property_id::text AS property_id,
                   portal_id::text AS portal_id, status, reason, source_version,
                   ${utc('effective_from')} AS effective_from,
                   ${utc('effective_to')} AS effective_to,
                   ${utc('observed_at')} AS observed_at
            FROM portal_health_intervals WHERE organization_id = ${organizationId}`,
      )

      return {
        version: 'portal-organization-export/v1' as const,
        requestedAsOf: asOf.toISOString(),
        snapshotBound: 'repeatable_read_within_15m_of_request' as const,
        portals: sortRecords(portals, ['id']),
        portalGroups: sortRecords(portalGroups, ['id']),
        portalGroupMembers: sortRecords(portalGroupMembers, ['portal_id', 'id']),
        linkCategories: sortRecords(linkCategories, ['portal_id', 'sort_key', 'id']),
        links: sortRecords(links, ['portal_id', 'category_id', 'sort_key', 'id']),
        approvedDestinations: sortRecords(approvedDestinations, ['property_id', 'id']),
        localizedOverrides: sortRecords(localizedOverrides, [
          'portal_id',
          'locale',
          'id',
        ]),
        brandProfiles: sortRecords(brandProfiles, ['property_id', 'id']),
        brandContents: sortRecords(brandContents, ['property_id', 'locale', 'id']),
        publicationSnapshots: sortRecords(publicationSnapshots, ['portal_id', 'id']),
        publicationActivations: sortRecords(publicationActivations, ['portal_id', 'id']),
        pendingContentChanges: sortRecords(pendingContentChanges, ['portal_id', 'id']),
        responsibleManagers: sortRecords(responsibleManagers, ['portal_id', 'id']),
        accessArtifacts: sortRecords(accessArtifacts, ['portal_id', 'id']),
        healthIntervals: sortRecords(healthIntervals, ['portal_id', 'id']),
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/**
 * Portal-owned Organization Export contribution.
 *
 * Exports the manager-authored Portal configuration and its immutable
 * publication history — the record of what a guest was actually shown. Address
 * tokens, upload issuances, and Guest Responses are not queried at all. An
 * Organization with no Portal rows answers `no_data` rather than shipping a
 * header-only CSV.
 */
export const createPortalOrganizationExportContributor = (
  db: Database,
): OrganizationExportContributor => {
  return Object.freeze({
    context: 'portal' as const,
    async contribute({ organizationId, asOf }) {
      const payload = await readPayload(db, organizationId, asOf)
      const isEmpty = collectionsOf(payload).every(([, records]) => records.length === 0)
      if (isEmpty) {
        return {
          context: 'portal' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'portal' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: [csvEntry(payload), jsonEntry(payload)],
      }
    },
  })
}
