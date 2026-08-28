import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const RETIRED_PROPERTY_ACCESS_ISLANDS = [
  'src/shared/auth/property-access-policy.ts',
  'src/shared/auth/property-access-policy.test.ts',
  'src/contexts/identity/domain/property-access-grant.ts',
  'src/contexts/identity/domain/property-access-grant.test.ts',
] as const

function source(path: string): string {
  return readFileSync(resolve(path), 'utf8')
}

describe('retired property-access islands stay contracted', () => {
  it('keeps the test-only duplicate policy and grant model absent', () => {
    expect(
      RETIRED_PROPERTY_ACCESS_ISLANDS.filter((path) => existsSync(resolve(path))),
    ).toEqual([])
  })

  it('pins the permission-scoped guard and persisted grant authority', () => {
    const access = source('src/shared/domain/property-access.ts')
    const identityBuild = source('src/contexts/identity/build.ts')
    const composition = source('src/composition.ts')

    expect(access).toContain('isPropertyAccessibleForPermission')
    expect(access).toContain('getAccessiblePropertyIdsForPermission')
    expect(identityBuild).toContain('hasActiveGrant')
    expect(identityBuild).toContain('grantPropertyAccess')
    expect(composition).toContain('createGrantAccessLookup(db, clock)')
  })
})
