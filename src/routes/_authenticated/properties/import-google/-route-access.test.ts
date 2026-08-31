import { describe, expect, it } from 'vitest'
import type { Role } from '#/shared/domain/roles'
import { requireGoogleImportRole } from './-route-access'

describe('requireGoogleImportRole', () => {
  it('allows AccountAdmin to enter every Google import route', () => {
    expect(() => requireGoogleImportRole('AccountAdmin')).not.toThrow()
  })

  it.each<Role>(['PropertyManager', 'Staff'])(
    'redirects %s before an import detail route can load',
    (role) => {
      let thrown: unknown
      try {
        requireGoogleImportRole(role)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toMatchObject({ options: { to: '/properties' } })
    },
  )
})
