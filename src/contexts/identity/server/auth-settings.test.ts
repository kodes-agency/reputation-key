// Identity context — auth settings server function tests
// Tests the inline Zod schemas used by the auth-settings server functions.
// These are thin wrappers around better-auth API — the main testable parts
// are the input validation schemas.

import { describe, it, expect } from 'vitest'
import { z } from 'zod/v4'

// ── Schemas (mirrored from auth-settings.ts) ──────────────────────

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
})

const updateProfileSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),
})

const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
})

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

// ── createOrganization input validation ───────────────────────────

describe('createOrganization schema', () => {
  it('accepts valid input', () => {
    const result = createOrganizationSchema.safeParse({
      name: 'Acme Corp',
      slug: 'acme-corp',
    })
    expect(result.success).toBe(true)
  })

  it('accepts slug with numbers', () => {
    const result = createOrganizationSchema.safeParse({
      name: 'Test Org',
      slug: 'test-org-123',
    })
    expect(result.success).toBe(true)
  })

  it('accepts slug with only numbers', () => {
    const result = createOrganizationSchema.safeParse({
      name: 'Test Org',
      slug: '123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing name', () => {
    const result = createOrganizationSchema.safeParse({
      slug: 'acme-corp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty name', () => {
    const result = createOrganizationSchema.safeParse({
      name: '',
      slug: 'acme-corp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing slug', () => {
    const result = createOrganizationSchema.safeParse({
      name: 'Acme Corp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty slug', () => {
    const result = createOrganizationSchema.safeParse({
      name: 'Acme Corp',
      slug: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects slug with uppercase letters', () => {
    const result = createOrganizationSchema.safeParse({
      name: 'Acme Corp',
      slug: 'Acme-Corp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects slug with spaces', () => {
    const result = createOrganizationSchema.safeParse({
      name: 'Acme Corp',
      slug: 'acme corp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects slug with underscores', () => {
    const result = createOrganizationSchema.safeParse({
      name: 'Acme Corp',
      slug: 'acme_corp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects slug with special characters', () => {
    const result = createOrganizationSchema.safeParse({
      name: 'Acme Corp',
      slug: 'acme@corp',
    })
    expect(result.success).toBe(false)
  })
})
