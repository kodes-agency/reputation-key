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

describe('quarantined Team permissions', () => {
  it('grants no Team action to any beta role', () => {
    for (const role of ['AccountAdmin', 'PropertyManager', 'Staff'] as const) {
      expect(can(role, 'team.create')).toBe(false)
      expect(can(role, 'team.update')).toBe(false)
      expect(can(role, 'team.delete')).toBe(false)
      expect(can(role, 'team.read')).toBe(false)
      expect(can(role, 'team.membership.manage')).toBe(false)
    }
  })
})
