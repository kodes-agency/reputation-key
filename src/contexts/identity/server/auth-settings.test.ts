// Identity context — auth settings server function tests
// Tests the Zod schemas the auth-settings server functions validate with,
// imported from the DTO modules production imports them from. These are thin
// wrappers around better-auth API — the main testable parts are the input
// validation schemas. The create-organization schema is tested beside its DTO
// (`create-organization.dto.test.ts`); a copy of it used to be tested here.

import { describe, it, expect } from 'vitest'
import { changePasswordCommandSchema as changePasswordSchema } from '../application/dto/change-password.dto'
import { updateProfileInputSchema as updateProfileSchema } from '../application/dto/profile-settings.dto'

// ── changePassword input validation ───────────────────────────────

describe('changePassword schema', () => {
  it('accepts valid input', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'old-password',
      newPassword: 'new-password-123',
    })
    expect(result.success).toBe(true)
  })

  it('accepts newPassword at exactly 8 characters', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'old',
      newPassword: '12345678',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing currentPassword', () => {
    const result = changePasswordSchema.safeParse({
      newPassword: 'new-password-123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty currentPassword', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: '',
      newPassword: 'new-password-123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing newPassword', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'old-password',
    })
    expect(result.success).toBe(false)
  })

  it('rejects newPassword under 8 characters', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'old-password',
      newPassword: '1234567',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty newPassword', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'old-password',
      newPassword: '',
    })
    expect(result.success).toBe(false)
  })
})

// ── updateProfile input validation ────────────────────────────────

describe('updateProfile schema', () => {
  it('accepts valid input', () => {
    const result = updateProfileSchema.safeParse({
      name: 'John Doe',
    })
    expect(result.success).toBe(true)
  })

  it('accepts name at exactly 100 characters', () => {
    const result = updateProfileSchema.safeParse({
      name: 'a'.repeat(100),
    })
    expect(result.success).toBe(true)
  })

  it('accepts single-character name', () => {
    const result = updateProfileSchema.safeParse({
      name: 'A',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing name', () => {
    const result = updateProfileSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty name', () => {
    const result = updateProfileSchema.safeParse({
      name: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects name over 100 characters', () => {
    const result = updateProfileSchema.safeParse({
      name: 'a'.repeat(101),
    })
    expect(result.success).toBe(false)
  })
})
