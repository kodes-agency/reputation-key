import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  authorizationExecutionPermits,
  capabilityExecutionControl,
  googleContentCapabilityEnum,
} from './google-content-control.schema'
import { googleConnections } from './google-connection.schema'

const columnNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((column) => column.name)

describe('Google Content control schema', () => {
  it('models every Google connection as Organization-owned', () => {
    const config = getTableConfig(googleConnections)
    expect(config.checks.map((constraint) => constraint.name)).toContain(
      'google_connections_organization_owned_check',
    )
    expect(config.columns.find((column) => column.name === 'visibility')?.default).toBe(
      'organization',
    )
  })

  it('persists monotonic kill/drain and bounded permit state', () => {
    expect(googleContentCapabilityEnum.enumValues).toEqual([
      'property.import_gbp_v2',
      'property.read_gbp_performance',
      'property.connect_gbp',
      'property.publish_reply',
    ])
    expect(columnNames(capabilityExecutionControl)).toEqual(
      expect.arrayContaining([
        'capability',
        'denied',
        'emergency_kill_version',
        'denied_at',
        'drained_at',
        'cleanup_drained_at',
      ]),
    )
    expect(columnNames(authorizationExecutionPermits)).toEqual(
      expect.arrayContaining([
        'state',
        'route_key',
        'route_catalog_version',
        'quota_policy_id',
        'start_deadline_at',
        'operation_deadline_at',
      ]),
    )
  })

  it('keeps connection cleanup state and admission metadata without credential bodies', () => {
    expect(columnNames(googleConnections)).toEqual(
      expect.arrayContaining(['credential_use_state', 'cleanup_material_deadline_at']),
    )

    const allColumns = [
      authorizationExecutionPermits,
      capabilityExecutionControl,
    ].flatMap(columnNames)
    expect(allColumns).not.toEqual(
      expect.arrayContaining([
        'access_token',
        'refresh_token',
        'provider_body',
        'provider_value',
      ]),
    )
  })
})
