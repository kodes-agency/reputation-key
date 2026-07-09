// Permission catalogue tests — derives the valid set from `statement` and parses
// Better Auth's role-permission JSON fail-soft.

import { describe, it, expect } from 'vitest'
import { statement } from './permissions'
import {
  VALID_PERMISSIONS,
  isPermission,
  parsePermissionStatement,
} from './permission-catalogue'

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

describe('isPermission', () => {
  it('accepts real permissions', () => {
    expect(isPermission('portal.read')).toBe(true)
    expect(isPermission('identity.avatar.set')).toBe(true)
  })

  it('rejects unknown resources / actions', () => {
    expect(isPermission('dashboard.bogus')).toBe(false)
    expect(isPermission('notareal.thing')).toBe(false)
    expect(isPermission('')).toBe(false)
  })

  it('narrows the type', () => {
    const s: string = 'goal.create'
    if (isPermission(s)) {
      // assignable to Permission
      const _p: typeof s = s
      expect(_p).toBe('goal.create')
    }
  })
})

describe('parsePermissionStatement', () => {
  it('flattens a valid subset into validated permissions', () => {
    const raw = JSON.stringify({ portal: ['read', 'update'], dashboard: ['read'] })
    expect([...parsePermissionStatement(raw)].sort()).toEqual([
      'dashboard.read',
      'portal.read',
      'portal.update',
    ])
  })

  it('preserves dotted actions (identity.password.change)', () => {
    const raw = JSON.stringify({ identity: ['password.change', 'profile.update'] })
    expect([...parsePermissionStatement(raw)].sort()).toEqual([
      'identity.password.change',
      'identity.profile.update',
    ])
  })

  it('returns [] for null / undefined / empty', () => {
    expect(parsePermissionStatement(null)).toEqual([])
    expect(parsePermissionStatement(undefined)).toEqual([])
    expect(parsePermissionStatement('')).toEqual([])
  })

  it('returns [] for corrupt JSON', () => {
    expect(parsePermissionStatement('{not json')).toEqual([])
  })

  it('returns [] for non-object JSON (array / number)', () => {
    expect(parsePermissionStatement('[1,2,3]')).toEqual([])
    expect(parsePermissionStatement('42')).toEqual([])
    expect(parsePermissionStatement('"a string"')).toEqual([])
    expect(parsePermissionStatement('null')).toEqual([])
  })

  it('drops unknown resources/actions, keeps valid ones', () => {
    const raw = JSON.stringify({ portal: ['read'], bogus: ['x'], dashboard: ['nope'] })
    expect(parsePermissionStatement(raw)).toEqual(['portal.read'])
  })

  it('skips non-array actions and non-string action entries', () => {
    const raw = JSON.stringify({ portal: 'read', team: ['read', 7, { x: 1 }, 'create'] })
    expect([...parsePermissionStatement(raw)].sort()).toEqual([
      'team.create',
      'team.read',
    ])
  })
})
