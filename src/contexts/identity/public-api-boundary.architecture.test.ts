import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(path), 'utf8')

describe('Identity public API composition boundary', () => {
  it('injects only the Identity facade each consuming context needs', () => {
    const composition = source('src/composition.ts')
    // ARC-03-T10: the leaf context builds (Activity among them) moved into the
    // root's read/notify module. The injection rule is unchanged; only the file
    // that performs it moved.
    const leafContexts = source('src/composition/read-and-notify-contexts.ts')
    const propertyBuild = source('src/contexts/property/build.ts')
    const portalBuild = source('src/contexts/portal/build.ts')
    const guestBuild = source('src/contexts/guest/build.ts')

    expect(propertyBuild).toContain('identityManagerFacts: IdentityManagerFactsPublicApi')
    expect(portalBuild).toContain('identityManagerFacts: IdentityManagerFactsPublicApi')
    expect(guestBuild).toContain('identityManagerFacts: IdentityManagerFactsPublicApi')
    expect(guestBuild).toContain(
      'identityAccountAdminAuthority: IdentityAccountAdminAuthorityPublicApi',
    )

    expect(composition.match(/identityPublicApi: identity\.publicApi/gu)).toHaveLength(1)
    expect(composition).not.toContain('identityApi: identity.publicApi')
    expect(composition).toContain('identityManagerFacts: identity.publicApi.managerFacts')
    expect(composition).toContain(
      'identityAccountAdminAuthority: identity.publicApi.accountAdminAuthority',
    )
    expect(leafContexts).toContain(
      'operationalHistoryAccessAuthority: input.identity.publicApi.accountAdminAuthority',
    )
  })

  it('keeps the complete Identity request facade at the Identity delivery boundary', () => {
    const composition = source('src/composition.ts')
    const identityPublicApi = source('src/contexts/identity/application/public-api.ts')

    expect(identityPublicApi).toContain('export type IdentityManagerFactsPublicApi')
    expect(identityPublicApi).toContain(
      'export type IdentityAccountAdminAuthorityPublicApi',
    )
    expect(identityPublicApi).toContain('export type IdentityRequestApi')
    expect(identityPublicApi).toContain('managerFacts: IdentityManagerFactsPublicApi')
    expect(identityPublicApi).toContain(
      'accountAdminAuthority: IdentityAccountAdminAuthorityPublicApi',
    )
    expect(identityPublicApi).toContain('requests: IdentityRequestApi')
    expect(composition).toContain('identityPublicApi: identity.publicApi')
  })
})
