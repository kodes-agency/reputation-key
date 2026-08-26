import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('tenant query cache transition ownership', () => {
  it('routes both application-shell sign-outs through the cache boundary', () => {
    const signOutOwners = [
      'src/components/layout/app-top-bar.tsx',
      'src/routes/__root.tsx',
    ]

    for (const path of signOutOwners) {
      const source = readFileSync(resolve(path), 'utf8')
      expect(source, path).toContain('clearTenantCacheAfterSessionEnd')
      expect(source, path).toContain('authClient.signOut()')
    }
  })

  it('clears any prior tenant cache before login rebuilds authenticated routes', () => {
    const login = readFileSync(resolve('src/routes/login.tsx'), 'utf8')

    expect(login).toContain('clearTenantCacheBeforeNavigation')
    expect(login.indexOf('clearTenantCacheBeforeNavigation')).toBeLessThan(
      login.indexOf('router.invalidate()'),
    )
  })

  it('clears the prior tenant cache when invitation acceptance changes the active organization', () => {
    const acceptInvitation = readFileSync(
      resolve('src/routes/accept-invitation.tsx'),
      'utf8',
    )

    expect(acceptInvitation).toContain('clearTenantCacheAfterTenantChange')
  })
})
