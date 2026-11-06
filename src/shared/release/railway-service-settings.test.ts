import { describe, expect, it } from 'vitest'
import { assertRailwayServiceSettings } from './railway-service-settings'
import { railwayServiceManifest } from './railway-service-settings.test-fixtures'

describe('deployed Railway service settings', () => {
  it.each(['web', 'worker'])('accepts the supported image-sourced %s', (service) => {
    expect(() =>
      assertRailwayServiceSettings(service, railwayServiceManifest(service), 1),
    ).not.toThrow()
  })

  it('accepts the web pre-deploy command as a string', () => {
    const manifest = railwayServiceManifest('web')
    expect(() =>
      assertRailwayServiceSettings(
        'web',
        {
          ...manifest,
          deploy: {
            ...manifest.deploy,
            preDeployCommand: 'node dist-worker/migrate-deploy.js',
          },
        },
        1,
      ),
    ).not.toThrow()
  })

  it.each(['web', 'worker'])('refuses unknown %s manifests', (service) => {
    for (const manifest of [undefined, null, {}, { deploy: {} }]) {
      expect(() => assertRailwayServiceSettings(service, manifest, 1)).toThrow(
        'does not match required service settings',
      )
    }
  })

  it.each(['web', 'worker'])('refuses unsupported %s replica counts', (service) => {
    for (const replicas of [0, 2, 10]) {
      expect(() =>
        assertRailwayServiceSettings(service, railwayServiceManifest(service), replicas),
      ).toThrow('does not match required service settings')
    }
  })

  it.each([
    ['web', 'preDeployCommand', null],
    ['web', 'preDeployCommand', []],
    ['web', 'preDeployCommand', ['node dist-worker/index.js']],
    ['web', 'healthcheckPath', '/api/health/live'],
    ['web', 'healthcheckTimeout', 30],
    ['web', 'startCommand', 'node .output/server/index.mjs'],
    ['worker', 'startCommand', 'node dist-worker/index.js'],
    ['worker', 'startCommand', null],
    ['worker', 'preDeployCommand', ['node dist-worker/migrate-deploy.js']],
    ['worker', 'healthcheckPath', '/api/health/ready'],
    ['web', 'restartPolicyType', 'NEVER'],
    ['worker', 'restartPolicyMaxRetries', 0],
    ['worker', 'drainingSeconds', 5],
  ])('refuses a %s deployment with an unsafe %s', (service, field, value) => {
    const manifest = railwayServiceManifest(String(service))
    manifest.deploy = { ...manifest.deploy, [String(field)]: value }
    expect(() => assertRailwayServiceSettings(String(service), manifest, 1)).toThrow(
      'does not match required service settings',
    )
  })
})
