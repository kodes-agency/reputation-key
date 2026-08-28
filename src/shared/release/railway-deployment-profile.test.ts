import { describe, expect, it } from 'vitest'
import {
  PRODUCTION_RAILWAY_PROJECT_NAME,
  REHEARSAL_RAILWAY_PROJECT_NAME,
  assertRailwayProjectNameForProfile,
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
