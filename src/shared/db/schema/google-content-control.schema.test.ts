import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  authorizationExecutionPermits,
  capabilityExecutionControl,
  credentialRevokePermits,
  googleContentCapabilityEnum,
  googleCredentialSourceOperations,
  googleSubjectAuthorityGuards,
} from './google-content-control.schema'
import { googleConnections } from './google-connection.schema'
import { policyVersion } from './policy.schema'

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
    expect(columnNames(policyVersion)).toContain('emergency_kill_version')
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

  it('models source authority and one-use cleanup without credential bodies', () => {
    expect(columnNames(googleConnections)).toEqual(
      expect.arrayContaining(['credential_use_state', 'cleanup_material_deadline_at']),
    )
    expect(columnNames(googleSubjectAuthorityGuards)).toEqual(
      expect.arrayContaining([
        'subject_hmac_key_version',
        'subject_hmac',
        'generation',
        'next_sequence',
        'source_cutoff_sequence',
        'state',
      ]),
    )
    expect(columnNames(googleCredentialSourceOperations)).toEqual(
      expect.arrayContaining([
        'guard_id',
        'source_work_permit_id',
        'sequence',
        'kind',
        'state',
      ]),
    )
    expect(columnNames(credentialRevokePermits)).toEqual(
      expect.arrayContaining([
        'guard_id',
        'source_operation_id',
        'token_hmac_key_version',
        'token_hmac',
        'cleanup_deadline_at',
        'send_authorization_expires_at',
        'state',
      ]),
    )

    const allColumns = [
      authorizationExecutionPermits,
      capabilityExecutionControl,
      credentialRevokePermits,
      googleCredentialSourceOperations,
      googleSubjectAuthorityGuards,
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
