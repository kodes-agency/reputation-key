// Identity context — OrganizationUpdatePatch builder tests
// Table-driven coverage of the field-inclusion table: the 9 optional update
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
//   billingCompanyName defined        null → undefined
//   billingAddress     defined        null → undefined
//   billingCity        defined        null → undefined
//   billingPostalCode  defined        null → undefined
//   billingCountry     defined        null → undefined
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

  it('maps null billing/contact fields to undefined while keeping the keys', () => {
    const patch = buildOrganizationUpdatePatch({
      contactEmail: null,
      billingCompanyName: null,
      billingAddress: null,
      billingCity: null,
      billingPostalCode: null,
      billingCountry: null,
    })

    for (const field of [
      'contactEmail',
      'billingCompanyName',
      'billingAddress',
      'billingCity',
      'billingPostalCode',
      'billingCountry',
    ]) {
      expect(patch).toHaveProperty(field)
      expect(patch[field]).toBeUndefined()
    }
  })

  it('passes billing/contact strings through unchanged', () => {
    const patch = buildOrganizationUpdatePatch({
      contactEmail: 'billing@test.com',
      billingCompanyName: 'Test Corp',
      billingAddress: '123 Billing St',
      billingCity: 'Hong Kong',
      billingPostalCode: '00000',
      billingCountry: 'HK',
    })

    expect(patch.contactEmail).toBe('billing@test.com')
    expect(patch.billingCompanyName).toBe('Test Corp')
    expect(patch.billingAddress).toBe('123 Billing St')
    expect(patch.billingCity).toBe('Hong Kong')
    expect(patch.billingPostalCode).toBe('00000')
    expect(patch.billingCountry).toBe('HK')
  })

  it('omits billing/contact fields that were never provided', () => {
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
