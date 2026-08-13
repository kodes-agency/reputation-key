import { describe, expect, it } from 'vitest'
import { validateGooglePerformanceLiveDependencies } from './google-performance-live-boundary'

describe('architecture: live Google Performance has no persistence dependency', () => {
  it('accepts only request-lifetime read and control-plane dependencies', () => {
    expect(
      validateGooglePerformanceLiveDependencies([
        { kind: 'execution_policy', modulePath: '#/shared/auth/execution-policy' },
        {
          kind: 'provider_content_lease',
          modulePath: '#/shared/auth/provider-content-lease.port',
        },
        {
          kind: 'property_reader',
          modulePath: '#/contexts/property/application/public-api',
        },
        {
          kind: 'google_performance_source',
          modulePath: '#/contexts/integration/application/google-provider-contract',
        },
        { kind: 'clock', modulePath: '#/shared/domain/clock' },
        { kind: 'authorization_audit', modulePath: '#/shared/audit/audit' },
      ]),
    ).toEqual({ ok: true })
  })

  it.each(['write_repository', 'queue', 'server_cache', 'metric_key'] as const)(
    'rejects an injected %s dependency',
    (kind) => {
      const result = validateGooglePerformanceLiveDependencies([
        { kind, modulePath: `#/injected/${kind}` },
      ])

      expect(result).toEqual({
        ok: false,
        violations: [`${kind}:#/injected/${kind}`],
      })
    },
  )

  it('rejects unknown dependency categories fail-closed', () => {
    expect(
      validateGooglePerformanceLiveDependencies([
        { kind: 'future_dependency', modulePath: '#/future/module' },
      ]),
    ).toEqual({
      ok: false,
      violations: ['future_dependency:#/future/module'],
    })
  })
})
