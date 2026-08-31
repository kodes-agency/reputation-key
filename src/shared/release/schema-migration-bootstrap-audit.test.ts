import { describe, expect, it } from 'vitest'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from './railway-deployment-profile'
import {
  canonicalSchemaMigrationBootstrapAuthorization,
  createSchemaMigrationBootstrapAuthorization,
  schemaMigrationBootstrapAuthorizationSha256,
} from './schema-migration-bootstrap-audit'

const digest = (value: string): string => value.repeat(64).slice(0, 64)

function authorization(allowed = true) {
  return {
    version: 'repkey-schema-migration-bootstrap-authorization-2' as const,
    evidenceKind: 'schema-migration-bootstrap-authorization' as const,
    recordedAt: '2026-08-27T10:00:00.000Z',
    command: 'release:migrate-cell' as const,
    correlationId: '11111111-1111-4111-8111-111111111111',
    operator: 'release@example.test',
    reason: 'bootstrap schema for reviewed single-US beta release',
    decision: {
      allowed,
      reason: allowed ? ('allowed' as const) : ('operator_not_registered' as const),
      action: 'system:ops' as const,
      policyVersion: 'schema-bootstrap-artifact-1' as const,
    },
    cell: 'us' as const,
    deploymentProfile: 'production' as const,
    target: {
      projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
      projectId: 'project-opaque-id',
      environment: 'cell-us' as const,
      environmentId: 'environment-opaque-id',
    },
    release: {
      manifestSha256: digest('1'),
      signatureBundleSha256: digest('2'),
      railwayPlanEvidenceSha256: digest('3'),
      iacSha256: digest('4'),
      releaseControllerSha256: digest('6'),
      migrationHead: '0140_single_us_beta_data_cell',
      imageReference: `ghcr.io/example/web@sha256:${digest('5')}`,
      imageDigest: `sha256:${digest('5')}`,
    },
  }
}

describe('schema migration bootstrap authorization evidence', () => {
  it('is canonical and content-addressed', () => {
    const value = createSchemaMigrationBootstrapAuthorization(authorization())
    const canonical = canonicalSchemaMigrationBootstrapAuthorization(value)
    expect(canonical.endsWith('\n')).toBe(true)
    expect(JSON.parse(canonical)).toEqual(value)
    expect(schemaMigrationBootstrapAuthorizationSha256(canonical)).toMatch(
      /^[0-9a-f]{64}$/u,
    )
  })

  it('records a fail-closed unregistered-operator denial', () => {
    expect(
      createSchemaMigrationBootstrapAuthorization(authorization(false)),
    ).toMatchObject({ decision: { allowed: false, reason: 'operator_not_registered' } })
  })

  it('refuses a contradictory decision', () => {
    expect(() =>
      createSchemaMigrationBootstrapAuthorization({
        ...authorization(),
        decision: { ...authorization().decision, reason: 'operator_not_registered' },
      }),
    ).toThrow('decision allowed and reason must agree')
  })
})
