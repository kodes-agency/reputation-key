import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  gbpImportItemRetryReceipts,
  gbpImportRequestItems,
  gbpImportRequests,
} from './google-import-v2.schema'

const columnNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((column) => column.name)

const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).checks.map((constraint) => constraint.name)

const indexNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).indexes.map((index) => index.config.name)

describe('Google import v2 durable schema', () => {
  it('keeps replay identity, immutable terminal bounds, and purge fencing on parents', () => {
    expect(columnNames(gbpImportRequests)).toEqual(
      expect.arrayContaining([
        'id',
        'organization_id',
        'request_id',
        'initiated_by',
        'status',
        'deletion_fence',
        'wire_replay_key_version',
        'wire_replay_digest',
        'semantic_replay_key_version',
        'semantic_replay_digest',
        'first_terminal_at',
        'purge_at',
      ]),
    )
    expect(indexNames(gbpImportRequests)).toEqual(
      expect.arrayContaining([
        'gbp_import_requests_org_request_unique',
        'gbp_import_requests_org_id_key',
      ]),
    )
    expect(checkNames(gbpImportRequests)).toEqual(
      expect.arrayContaining([
        'gbp_import_requests_replay_pairs_valid',
        'gbp_import_requests_terminal_times_valid',
        'gbp_import_requests_counts_valid',
      ]),
    )
  })

  it('stores only confirmed tenant profile plus protected routing and effect fences', () => {
    expect(columnNames(gbpImportRequestItems)).toEqual(
      expect.arrayContaining([
        'organization_id',
        'import_job_id',
        'connection_id',
        'existing_property_id',
        'provider_account_suffix',
        'provider_location_suffix',
        'expected_connection_lifecycle_version',
        'expected_connection_access_version',
        'expected_credential_generation',
        'expected_source_epoch',
        'expected_profile_version',
        'property_name',
        'property_address',
        'country_code',
        'timezone',
        'processing_region',
        'routing_policy_version',
        'effect_deadline_at',
        'retry_revision',
        'highest_attempt_for_revision',
        'claim_fence',
        'claim_lease_expires_at',
        'first_terminal_at',
      ]),
    )
    expect(checkNames(gbpImportRequestItems)).toEqual(
      expect.arrayContaining([
        'gbp_import_request_items_profile_valid',
        'gbp_import_request_items_attempt_fence_valid',
        'gbp_import_request_items_routing_retention_valid',
      ]),
    )
    const parentFk = getTableConfig(gbpImportRequestItems).foreignKeys.find(
      (candidate) => candidate.getName() === 'gbp_import_request_items_parent_tenant_fk',
    )
    expect(parentFk?.onDelete).toBe('cascade')
    expect(parentFk?.reference().columns.map((column) => column.name)).toEqual([
      'organization_id',
      'import_job_id',
    ])
  })

  it('tenant-keys retry idempotency receipts and cascades them from their item', () => {
    expect(columnNames(gbpImportItemRetryReceipts)).toEqual(
      expect.arrayContaining([
        'organization_id',
        'initiating_user_id',
        'item_id',
        'retry_request_id',
        'request_digest_key_version',
        'request_digest',
        'accepted_retry_revision',
      ]),
    )
    expect(indexNames(gbpImportItemRetryReceipts)).toContain(
      'gbp_import_item_retry_receipts_request_unique',
    )
    const itemFk = getTableConfig(gbpImportItemRetryReceipts).foreignKeys.find(
      (candidate) =>
        candidate.getName() === 'gbp_import_item_retry_receipts_item_tenant_fk',
    )
    expect(itemFk?.onDelete).toBe('cascade')
  })
})
