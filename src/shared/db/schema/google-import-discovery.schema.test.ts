import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { googleImportDiscoveryRecords } from './google-import-discovery.schema'

const config = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table)

describe('durable Google import discovery schema', () => {
  it('stores unbounded page checkpoints behind tenant and expiry indexes', () => {
    const table = config(googleImportDiscoveryRecords)
    const columns = table.columns.map((column) => column.name)
    expect(columns).toEqual(
      expect.arrayContaining([
        'reference_key',
        'audience',
        'organization_id',
        'user_id',
        'connection_id',
        'authorization_vector',
        'payload',
        'affected_property_id',
        'remaining_redemptions',
        'claim_request_id',
        'expires_at',
      ]),
    )
    expect(table.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'google_import_discovery_records_scope_idx',
        'google_import_discovery_records_property_idx',
        'google_import_discovery_records_expiry_idx',
      ]),
    )
    expect(table.checks.map((constraint) => constraint.name)).toContain(
      'google_import_discovery_records_window_valid',
    )
  })
})
