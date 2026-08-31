// Identity context — OrganizationUpdatePatch builder tests
// Table-driven coverage of the beta field-inclusion table: the supported update
// fields → Better Auth payload semantics (moved from update-organization.test.ts).

import { describe, it, expect } from 'vitest'
import { buildOrganizationUpdatePatch } from './organization-update-patch'

// ── Field-inclusion table ───────────────────────────────────────
//
//   field              include when   value mapping
//   name               truthy         as-is
//   slug               truthy         as-is
//   logo               always         null → undefined
//   contactEmail       defined        null → undefined
//   responseSlaHours   defined        as-is

describe('buildOrganizationUpdatePatch', () => {
  it('includes name and slug when provided', () => {
    const patch = buildOrganizationUpdatePatch({
      name: 'New Org Name',
      slug: 'new-org-slug',
    })

    expect(patch.name).toBe('New Org Name')
    expect(patch.slug).toBe('new-org-slug')
  })

  it('omits name and slug when not provided', () => {
    const patch = buildOrganizationUpdatePatch({ logo: 'https://example.com/logo.png' })

    expect(patch).not.toHaveProperty('name')
    expect(patch).not.toHaveProperty('slug')
  })

  it('omits empty-string name and slug (truthy rule, not defined rule)', () => {
    const patch = buildOrganizationUpdatePatch({ name: '', slug: '' })

    expect(patch).not.toHaveProperty('name')
    expect(patch).not.toHaveProperty('slug')
  })

  it('always includes the logo key, mapping null → undefined for Better Auth', () => {
    expect(buildOrganizationUpdatePatch({}).logo).toBeUndefined()
    expect(buildOrganizationUpdatePatch({ logo: null }).logo).toBeUndefined()
    expect(buildOrganizationUpdatePatch({ logo: 'https://example.com/l.png' }).logo).toBe(
      'https://example.com/l.png',
    )
  })

  it('maps a null contact field to undefined while keeping the key', () => {
    const patch = buildOrganizationUpdatePatch({
      contactEmail: null,
    })

    expect(patch).toHaveProperty('contactEmail')
    expect(patch.contactEmail).toBeUndefined()
  })

  it('passes the supported contact string through unchanged', () => {
    const patch = buildOrganizationUpdatePatch({ contactEmail: 'billing@test.com' })

    expect(patch.contactEmail).toBe('billing@test.com')
  })

  it('does not forward dormant billing keys from an untyped caller', () => {
    const patch = buildOrganizationUpdatePatch({
      contactEmail: 'billing@test.com',
      billingCompanyName: 'Test Corp',
      billingAddress: '123 Billing St',
      billingCity: 'Hong Kong',
      billingPostalCode: '00000',
      billingCountry: 'HK',
    } as Parameters<typeof buildOrganizationUpdatePatch>[0])

    expect(patch.contactEmail).toBe('billing@test.com')
    expect(patch).not.toHaveProperty('billingCompanyName')
    expect(patch).not.toHaveProperty('billingAddress')
    expect(patch).not.toHaveProperty('billingCity')
    expect(patch).not.toHaveProperty('billingPostalCode')
    expect(patch).not.toHaveProperty('billingCountry')
  })

  it('omits contact and billing fields when they were never provided', () => {
    const patch = buildOrganizationUpdatePatch({ name: 'Org' })

    expect(patch).not.toHaveProperty('contactEmail')
    expect(patch).not.toHaveProperty('billingCompanyName')
    expect(patch).not.toHaveProperty('billingAddress')
    expect(patch).not.toHaveProperty('billingCity')
    expect(patch).not.toHaveProperty('billingPostalCode')
    expect(patch).not.toHaveProperty('billingCountry')
  })

  it('passes responseSlaHours through as-is, and only when provided', () => {
    expect(buildOrganizationUpdatePatch({ responseSlaHours: 24 }).responseSlaHours).toBe(
      24,
    )
    expect(buildOrganizationUpdatePatch({}).responseSlaHours).toBeUndefined()
    expect(buildOrganizationUpdatePatch({})).not.toHaveProperty('responseSlaHours')
  })
})
