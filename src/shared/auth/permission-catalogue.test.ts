// Permission catalogue tests — derives the valid set from `statement`.

import { describe, it, expect } from 'vitest'
import { statement } from './permissions'
import { VALID_PERMISSIONS } from './permission-catalogue'

describe('VALID_PERMISSIONS', () => {
  it('derives every resource.action from statement', () => {
    // Sanity: a couple of known perms including the dotted-action identity ones.
    expect(VALID_PERMISSIONS).toContain('dashboard.read')
    expect(VALID_PERMISSIONS).toContain('portal.read')
    expect(VALID_PERMISSIONS).toContain('identity.password.change')
    expect(VALID_PERMISSIONS).toContain('dashboard.fleet_read')
  })

  it('has no duplicates', () => {
    expect(new Set(VALID_PERMISSIONS).size).toBe(VALID_PERMISSIONS.length)
  })

  it('count matches the statement flatten (guards against silent drift)', () => {
    const expected = Object.values(statement).reduce(
      (n, actions) => n + actions.length,
      0,
    )
    expect(VALID_PERMISSIONS.length).toBe(expected)
  })
})
