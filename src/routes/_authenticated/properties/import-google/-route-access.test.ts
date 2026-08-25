import { describe, expect, it } from 'vitest'
import type { Role } from '#/shared/domain/roles'
import { requireGoogleImportRole } from './-route-access'

describe('requireGoogleImportRole', () => {
  it.each<Role>(['AccountAdmin', 'PropertyManager'])(
    'allows %s to enter every Google import route',
    (role) => {
      expect(() => requireGoogleImportRole(role)).not.toThrow()
    },
  )

  it('redirects Staff before an import detail route can load', () => {
    let thrown: unknown
    try {
      requireGoogleImportRole('Staff')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ options: { to: '/properties' } })
  })
})
