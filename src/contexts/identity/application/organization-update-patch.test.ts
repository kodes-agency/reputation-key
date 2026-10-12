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
//   logo               always         as-is (null clears it)
//   contactEmail       defined        as-is (null clears it)

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

  // Better Auth skips an `undefined` field on update, so only `null` clears a column.
  // A removal mapped to `undefined` saved nothing: the logo reappeared on reload.
  it('leaves the logo alone when the input has none', () => {
    expect(buildOrganizationUpdatePatch({}).logo).toBeUndefined()
  })

  it('passes a null logo through, so removing the logo is saved', () => {
    const patch = buildOrganizationUpdatePatch({ logo: null })

    expect(patch).toHaveProperty('logo')
    expect(patch.logo).toBeNull()
  })

  it('passes a logo address through unchanged', () => {
    expect(buildOrganizationUpdatePatch({ logo: 'https://example.com/l.png' }).logo).toBe(
      'https://example.com/l.png',
    )
  })

  // Better Auth skips an `undefined` field on update, so only `null` clears the contact
  // email. A clear mapped to `undefined` saved nothing: the email came back on reload.
  it('passes a null contact email through, so clearing it is saved', () => {
    const patch = buildOrganizationUpdatePatch({
      contactEmail: null,
    })

    expect(patch).toHaveProperty('contactEmail')
    expect(patch.contactEmail).toBeNull()
  })

  it('passes the supported contact string through unchanged', () => {
    const patch = buildOrganizationUpdatePatch({ contactEmail: 'contact@test.com' })

    expect(patch.contactEmail).toBe('contact@test.com')
  })

  it('omits contact when it was never provided', () => {
    const patch = buildOrganizationUpdatePatch({ name: 'Org' })

    expect(patch).not.toHaveProperty('contactEmail')
  })
})
