import { describe, it, expect } from 'vitest'
import { validateTeamName } from './rules'
import { can } from '#/shared/domain/permissions'

describe('validateTeamName', () => {
  it('accepts valid names', () => {
    const result = validateTeamName('Front Desk')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe('Front Desk')
  })

  it('trims whitespace', () => {
    const result = validateTeamName('  Housekeeping  ')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe('Housekeeping')
  })

  it('rejects empty names', () => {
    const result = validateTeamName('')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('invalid_name')
  })

  it('rejects whitespace-only names', () => {
    const result = validateTeamName('   ')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('invalid_name')
  })

  it('rejects names over 100 characters', () => {
    const result = validateTeamName('a'.repeat(101))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('invalid_name')
  })

  it('accepts names at exactly 100 characters', () => {
    const result = validateTeamName('a'.repeat(100))
    expect(result.isOk()).toBe(true)
  })
})

// ── Authorization rules (centralized permission system) ────────────

describe('team.create permission', () => {
  it('allows PropertyManager and AccountAdmin', () => {
    expect(can('AccountAdmin', 'team.create')).toBe(true)
    expect(can('PropertyManager', 'team.create')).toBe(true)
  })

  it('rejects Staff', () => {
    expect(can('Staff', 'team.create')).toBe(false)
  })
})

describe('team.update permission', () => {
  it('allows PropertyManager and AccountAdmin', () => {
    expect(can('AccountAdmin', 'team.update')).toBe(true)
    expect(can('PropertyManager', 'team.update')).toBe(true)
  })

  it('rejects Staff', () => {
    expect(can('Staff', 'team.update')).toBe(false)
  })
})

describe('team.delete permission', () => {
  it('allows only AccountAdmin', () => {
    expect(can('AccountAdmin', 'team.delete')).toBe(true)
    expect(can('PropertyManager', 'team.delete')).toBe(false)
    expect(can('Staff', 'team.delete')).toBe(false)
  })
})
