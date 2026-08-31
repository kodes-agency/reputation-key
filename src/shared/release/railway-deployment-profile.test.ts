import { describe, expect, it } from 'vitest'
import {
  CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME,
  CLOSED_BETA_RAILWAY_PROJECT_NAME,
  CELL_US_RAILWAY_ENVIRONMENT_NAME,
  PRODUCTION_RAILWAY_PROJECT_NAME,
  REHEARSAL_RAILWAY_PROJECT_NAME,
  assertRailwayDeploymentTarget,
  assertRailwayProjectNameForProfile,
  railwayDeploymentTargetFor,
} from './railway-deployment-profile'

describe('Railway deployment project isolation', () => {
  it('binds production and rehearsal to distinct dedicated projects', () => {
    expect(PRODUCTION_RAILWAY_PROJECT_NAME).toBe('reputation-key-us-beta')
    expect(REHEARSAL_RAILWAY_PROJECT_NAME).toBe('reputation-key-us-beta-rehearsal')

    expect(() =>
      assertRailwayProjectNameForProfile('production', 'reputation-key-us-beta'),
    ).not.toThrow()
    expect(() =>
      assertRailwayProjectNameForProfile('rehearsal', 'reputation-key-us-beta-rehearsal'),
    ).not.toThrow()
  })

  it.each([
    ['production', 'reputation-key'],
    ['production', 'reputation-key-us-beta-rehearsal'],
    ['rehearsal', 'reputation-key-us-beta'],
    ['rehearsal', 'arbitrary-lookalike-project'],
  ] as const)('refuses %s in project %s', (profile, projectName) => {
    expect(() => assertRailwayProjectNameForProfile(profile, projectName)).toThrow(
      'Railway project mismatch',
    )
  })
})

describe('Railway deployment target by release posture', () => {
  // The break this fixes: `web` built from git and then refused to deploy,
  // because the migration authority demanded a project named
  // `reputation-key-us-beta` and an environment named `cell-us` while the
  // closed beta actually runs in `reputation-key` / `google-closed-beta`.
  // The gate was right to refuse — the names genuinely did not match — so the
  // fix is to teach it the target the closed beta really has, keyed on posture
  // so the strict one returns by itself when the audience widens.
  it('authorizes the closed beta where it actually runs', () => {
    expect(railwayDeploymentTargetFor('closed-beta', 'production')).toEqual({
      projectName: CLOSED_BETA_RAILWAY_PROJECT_NAME,
      environmentName: CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME,
    })
    expect(CLOSED_BETA_RAILWAY_PROJECT_NAME).toBe('reputation-key')
    expect(CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME).toBe('google-closed-beta')
  })

  it('re-arms the dedicated cell the moment the audience widens', () => {
    for (const posture of ['open-beta', 'ga'] as const) {
      expect(railwayDeploymentTargetFor(posture, 'production')).toEqual({
        projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
        environmentName: CELL_US_RAILWAY_ENVIRONMENT_NAME,
      })
      expect(railwayDeploymentTargetFor(posture, 'rehearsal')).toEqual({
        projectName: REHEARSAL_RAILWAY_PROJECT_NAME,
        environmentName: CELL_US_RAILWAY_ENVIRONMENT_NAME,
      })
    }
  })

  it('has no rehearsal target while the beta is closed', () => {
    // A closed beta has exactly one environment. Inventing a rehearsal name
    // that no environment answers to would be a target that always fails at
    // deploy time instead of failing here, where the reason is legible.
    expect(railwayDeploymentTargetFor('closed-beta', 'rehearsal')).toBeNull()
    expect(() =>
      assertRailwayDeploymentTarget('closed-beta', 'rehearsal', {
        projectName: CLOSED_BETA_RAILWAY_PROJECT_NAME,
        environmentName: CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME,
      }),
    ).toThrow('no rehearsal target exists at closed-beta')
  })

  it('accepts the exact target and refuses every near miss', () => {
    expect(() =>
      assertRailwayDeploymentTarget('closed-beta', 'production', {
        projectName: 'reputation-key',
        environmentName: 'google-closed-beta',
      }),
    ).not.toThrow()

    expect(() =>
      assertRailwayDeploymentTarget('closed-beta', 'production', {
        projectName: 'reputation-key-us-beta',
        environmentName: 'google-closed-beta',
      }),
    ).toThrow('Railway project mismatch')

    expect(() =>
      assertRailwayDeploymentTarget('closed-beta', 'production', {
        projectName: 'reputation-key',
        environmentName: 'cell-us',
      }),
    ).toThrow('Railway environment mismatch')
  })

  it('refuses the closed-beta target once the posture has widened', () => {
    // The whole point of keying on posture: widening the constant makes the
    // loose target stop being accepted, with nobody remembering to do it.
    expect(() =>
      assertRailwayDeploymentTarget('open-beta', 'production', {
        projectName: CLOSED_BETA_RAILWAY_PROJECT_NAME,
        environmentName: CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME,
      }),
    ).toThrow('Railway project mismatch')
  })
})
