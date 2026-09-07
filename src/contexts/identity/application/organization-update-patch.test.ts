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
    const patch = buildOrganizationUpdatePatch({ contactEmail: 'contact@test.com' })

    expect(patch.contactEmail).toBe('contact@test.com')
  })


  it('omits contact when it was never provided', () => {
    const patch = buildOrganizationUpdatePatch({ name: 'Org' })

    expect(patch).not.toHaveProperty('contactEmail')
  })
})
