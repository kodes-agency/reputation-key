import { describe, expect, it } from 'vitest'
import { describeRoleChange } from './role-change'

describe('describeRoleChange', () => {
  it('cannot confirm before a role is chosen', () => {
    expect(describeRoleChange('Member', null, 'Maria')).toEqual({
      canConfirm: false,
      note: 'Choose a role for Maria.',
    })
  })

  it('cannot confirm the role the member already has', () => {
    const change = describeRoleChange('PropertyManager', 'PropertyManager', 'Maria')
    expect(change.canConfirm).toBe(false)
    expect(change.note).toBe('Maria already has this role.')
  })

  it('explains a promotion by what the new role can do', () => {
    const change = describeRoleChange('PropertyManager', 'AccountAdmin', 'Maria')
    expect(change.canConfirm).toBe(true)
    expect(change.note).toContain('Maria will see every property')
    expect(change.note).toContain('Google connection')
  })

  it('explains a demotion: only granted properties, and the last-admin refusal', () => {
    const change = describeRoleChange('AccountAdmin', 'PropertyManager', 'Petar')
    expect(change.canConfirm).toBe(true)
    expect(change.note).toContain('Petar will see only the properties you grant')
    expect(change.note).toContain('last Account Admin')
  })

  it('does not mention the last-admin refusal when nobody is being demoted', () => {
    const change = describeRoleChange('Member', 'PropertyManager', 'Nikolay')
    expect(change.canConfirm).toBe(true)
    expect(change.note).not.toContain('last Account Admin')
  })
})
