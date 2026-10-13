// Identity context — create-organization DTO.
//
// These cases ran for months against a copy of the schema written into
// `server/auth-settings.test.ts`. The copy kept the old inline slug regex after
// production moved to the domain's `validateSlug`, so it accepted a
// one-character slug and a leading hyphen that production refuses, and nothing
// here could notice a change to the real schema.

import { describe, it, expect } from 'vitest'
import { createOrganizationInputSchema } from './create-organization.dto'

describe('createOrganizationInputSchema', () => {
  it('accepts valid input', () => {
    const result = createOrganizationInputSchema.safeParse({
      name: 'Acme Corp',
      slug: 'acme-corp',
    })
    expect(result.success).toBe(true)
  })

  it('accepts slug with numbers', () => {
    const result = createOrganizationInputSchema.safeParse({
      name: 'Test Org',
      slug: 'test-org-123',
    })
    expect(result.success).toBe(true)
  })

  it('accepts slug with only numbers', () => {
    const result = createOrganizationInputSchema.safeParse({
      name: 'Test Org',
      slug: '123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing name', () => {
    const result = createOrganizationInputSchema.safeParse({
      slug: 'acme-corp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty name', () => {
    const result = createOrganizationInputSchema.safeParse({
      name: '',
      slug: 'acme-corp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing slug', () => {
    const result = createOrganizationInputSchema.safeParse({
      name: 'Acme Corp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty slug', () => {
    const result = createOrganizationInputSchema.safeParse({
      name: 'Acme Corp',
      slug: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects slug with uppercase letters', () => {
    const result = createOrganizationInputSchema.safeParse({
      name: 'Acme Corp',
      slug: 'Acme-Corp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects slug with spaces', () => {
    const result = createOrganizationInputSchema.safeParse({
      name: 'Acme Corp',
      slug: 'acme corp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects slug with underscores', () => {
    const result = createOrganizationInputSchema.safeParse({
      name: 'Acme Corp',
      slug: 'acme_corp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a one-character slug', () => {
    expect(
      createOrganizationInputSchema.safeParse({ name: 'Acme', slug: 'a' }).success,
    ).toBe(false)
  })

  it('rejects a slug that starts with a hyphen', () => {
    expect(
      createOrganizationInputSchema.safeParse({ name: 'Acme', slug: '-acme' }).success,
    ).toBe(false)
  })

  it('rejects slug with special characters', () => {
    const result = createOrganizationInputSchema.safeParse({
      name: 'Acme Corp',
      slug: 'acme@corp',
    })
    expect(result.success).toBe(false)
  })
})
