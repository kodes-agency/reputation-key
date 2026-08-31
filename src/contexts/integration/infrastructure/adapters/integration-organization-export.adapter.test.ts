import { describe, expect, it } from 'vitest'
import {
  buildOrganizationExportBundle,
  CLASSIFICATIONS_BY_CONTEXT,
} from '#/contexts/identity/application/organization-export-contract'
import type { OrganizationLifecycleContext } from '#/contexts/identity/application/ports/organization-export-contributor.port'
import {
  buildIntegrationExportEntries,
  integrationExportRecordCount,
  sortIntegrationExportRows,
  type IntegrationOrganizationExportPayload,
} from './integration-organization-export.adapter'

const ASOF = new Date('2026-08-28T09:00:00.000Z')

// Derived from the contract rather than restated, so a context added to the
// bundle cannot leave this file asserting against a stale set.
const ALL_CONTEXTS = Object.keys(
  CLASSIFICATIONS_BY_CONTEXT,
) as readonly OrganizationLifecycleContext[]

const connection = (id: string, createdAt: string) => ({
  id,
  status: 'active',
  visibility: 'organization',
  credential_use_state: 'active',
  lifecycle_version: 1,
  access_version: 1,
  credential_generation: 1,
  credential_home_cell_id: 'us',
  credential_home_policy_version: 1,
  credential_home_authority_generation: 1,
  connected_by: 'user-1',
  credential_authorized_by: 'user-1',
  status_reason: null,
  credential_authorized_at: '2026-08-01T00:00:00.000000Z',
  last_successful_sync_at: '2026-08-27T00:00:00.000000Z',
  status_changed_at: '2026-08-01T00:00:00.000000Z',
  cleanup_material_deadline_at: null,
  created_at: createdAt,
  updated_at: createdAt,
})

const payload = (
  overrides: Partial<IntegrationOrganizationExportPayload> = {},
): IntegrationOrganizationExportPayload => ({
  version: 'integration-organization-export/v1',
  requestedAsOf: ASOF.toISOString(),
  snapshotBound: 'repeatable_read_within_15m_of_request',
  googleConnections: [
    connection('a1', '2026-08-01T00:00:00.000000Z'),
    connection('b2', '2026-08-02T00:00:00.000000Z'),
  ],
  credentialHomeAuthority: [
    {
      authority_generation: 1,
      home_cell_id: 'us',
      catalogue_policy_version: 1,
      transition_reason: 'new_grant',
      effective_from: '2026-08-01T00:00:00.000000Z',
      superseded_at: null,
      created_at: '2026-08-01T00:00:00.000000Z',
      updated_at: '2026-08-01T00:00:00.000000Z',
    },
  ],
  importSagas: [],
  importBatches: [],
  importItemStateCounts: [
    {
      import_job_id: 'job-1',
      status: 'imported',
      action: 'create',
      outcome_code: 'imported',
      item_count: 3,
      first_created_at: '2026-08-03T00:00:00.000000Z',
      last_updated_at: '2026-08-03T00:10:00.000000Z',
    },
  ],
  disconnectCleanupAttempts: [],
  excludedRecordClasses: [
    { recordClass: 'google_oauth_credentials', reasonCode: 'security_secret_material' },
  ],
  ...overrides,
})

const text = (entries: readonly { path: string; bytes: Uint8Array }[], path: string) =>
  Buffer.from(entries.find((entry) => entry.path === path)!.bytes).toString('utf8')

describe('Integration Organization Export entries', () => {
  it('renders byte-identical files for the same payload', () => {
    expect(buildIntegrationExportEntries(payload())).toEqual(
      buildIntegrationExportEntries(payload()),
    )
  })

  it('orders rows by UTF-8 bytes, not by the order PostgreSQL returned them', () => {
    // 'Z' (0x5A) sorts before 'a' (0x61) in byte order but after it under a
    // case-insensitive host collation, so this pair pins the comparison used.
    const rows = [
      { id: 'a1', created_at: '2026-08-02T00:00:00.000000Z' },
      { id: 'Z9', created_at: '2026-08-02T00:00:00.000000Z' },
      { id: 'a0', created_at: '2026-08-01T00:00:00.000000Z' },
    ]
    const sortKey = (record: Readonly<Record<string, unknown>>) => [
      record.created_at as string,
      record.id as string,
    ]

    expect(sortIntegrationExportRows(rows, sortKey).map(({ id }) => id)).toEqual([
      'a0',
      'Z9',
      'a1',
    ])
    expect(sortIntegrationExportRows([...rows].reverse(), sortKey)).toEqual(
      sortIntegrationExportRows(rows, sortKey),
    )
  })

  it('classifies both entries content_free_lifecycle under integration/', () => {
    expect(
      buildIntegrationExportEntries(payload()).map(
        ({ path, mediaType, classification }) => ({ path, mediaType, classification }),
      ),
    ).toEqual([
      {
        path: 'integration/google-lifecycle.csv',
        mediaType: 'text/csv',
        classification: 'content_free_lifecycle',
      },
      {
        path: 'integration/google-lifecycle.json',
        mediaType: 'application/json',
        classification: 'content_free_lifecycle',
      },
    ])
  })

  it('stamps only a classification the contract permits Integration to use', () => {
    for (const entry of buildIntegrationExportEntries(payload())) {
      expect(CLASSIFICATIONS_BY_CONTEXT.integration).toContain(entry.classification)
    }
  })

  it('keeps every collection in one CSV, tagged by record type', () => {
    const rows = text(
      buildIntegrationExportEntries(payload()),
      'integration/google-lifecycle.csv',
    )
      .trimEnd()
      .split('\n')

    expect(rows[0]?.startsWith('record_type,record_id,connection_id,')).toBe(true)
    expect(rows.slice(1).map((row) => row.split(',')[0])).toEqual([
      'google_connection',
      'google_connection',
      'credential_home_authority',
      'import_item_state_count',
    ])
  })

  it('counts every collection when deciding complete versus no_data', () => {
    expect(integrationExportRecordCount(payload())).toBe(4)
    expect(
      integrationExportRecordCount(
        payload({
          googleConnections: [],
          credentialHomeAuthority: [],
          importItemStateCounts: [],
        }),
      ),
    ).toBe(0)
  })

  it('is accepted by the Organization Export bundle builder', async () => {
    const entries = buildIntegrationExportEntries(payload())
    const bundle = await buildOrganizationExportBundle({
      organizationId: 'org-1',
      requestId: 'req-1',
      asOf: ASOF,
      contributors: ALL_CONTEXTS.map((context) =>
        context === 'integration'
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
        'integration/google-lifecycle.csv',
        'integration/google-lifecycle.json',
      ]),
    )
  })

  it('is rejected if it ever tries to widen its own disclosure', async () => {
    const [csv, json] = buildIntegrationExportEntries(payload())
    await expect(
      buildOrganizationExportBundle({
        organizationId: 'org-1',
        requestId: 'req-1',
        asOf: ASOF,
        contributors: ALL_CONTEXTS.map((context) =>
          context === 'integration'
            ? {
                context,
                contribute: async () => ({
                  context,
                  coverage: 'complete' as const,
                  omissionCodes: [],
                  entries: [
                    { ...csv!, classification: 'tenant_visible' as const },
                    json!,
                  ],
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
      }),
    ).rejects.toThrow(/classification is not permitted for integration/)
  })
})
