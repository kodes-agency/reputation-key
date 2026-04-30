// Portal context — domain constructors tests
// Per architecture: "Pure unit, no setup, no mocks. Run in milliseconds."

import { describe, it, expect } from 'vitest'
import { buildPortal, buildPortalLinkCategory, buildPortalLink } from './constructors'
import { portalId, organizationId, propertyId, portalLinkCategoryId, portalLinkId } from '#/shared/domain/ids'

const now = new Date('2025-01-01T00:00:00Z')

// ── buildPortal ────────────────────────────────────────────────────

describe('buildPortal', () => {
  const base = {
    id: portalId('test-id'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    now,
  }

  it('builds a portal with defaults', () => {
    const result = buildPortal({ ...base, name: 'Test Portal' })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.name).toBe('Test Portal')
      expect(result.value.entityType).toBe('property')
      expect(result.value.isActive).toBe(true)
      expect(result.value.smartRoutingEnabled).toBe(false)
      expect(result.value.smartRoutingThreshold).toBe(4)
    }
  })

  it('auto-generates slug from name', () => {
    const result = buildPortal({ ...base, name: 'My Portal' })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.slug).toBe('my-portal')
    }
  })

  it('uses provided slug when given', () => {
    const result = buildPortal({ ...base, name: 'Test', providedSlug: 'custom-slug' })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.slug).toBe('custom-slug')
    }
  })

  it('rejects invalid name', () => {
    const result = buildPortal({ ...base, name: '' })
    expect(result.isErr()).toBe(true)
  })

  it('rejects invalid theme', () => {
    const result = buildPortal({
      ...base,
      name: 'Test',
      theme: { primaryColor: 'not-a-color' },
    })
    expect(result.isErr()).toBe(true)
  })

  it('accepts custom theme', () => {
    const result = buildPortal({
      ...base,
      name: 'Test',
      theme: {
        primaryColor: '#FF5500',
        backgroundColor: '#FFFFFF',
        textColor: '#000000',
      },
    })
    expect(result.isOk()).toBe(true)
  })

  it('sets entityId to propertyId by default', () => {
    const result = buildPortal({ ...base, name: 'Test' })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.entityId).toBe(result.value.propertyId as unknown as string)
    }
  })
})

// ── buildPortalLinkCategory ────────────────────────────────────────

describe('buildPortalLinkCategory', () => {
  it('builds a valid category', () => {
    const result = buildPortalLinkCategory({
      id: portalLinkCategoryId('cat-1'),
      portalId: portalId('portal-1'),
      organizationId: organizationId('org-1'),
      title: 'Reviews',
      sortKey: 'a0',
      now,
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.title).toBe('Reviews')
      expect(result.value.sortKey).toBe('a0')
    }
  })

  it('rejects empty title', () => {
    const result = buildPortalLinkCategory({
      id: portalLinkCategoryId('cat-1'),
      portalId: portalId('portal-1'),
      organizationId: organizationId('org-1'),
      title: '',
      sortKey: 'a0',
      now,
    })
    expect(result.isErr()).toBe(true)
  })
})

// ── buildPortalLink ────────────────────────────────────────────────

describe('buildPortalLink', () => {
  it('builds a valid link', () => {
    const result = buildPortalLink({
      id: portalLinkId('link-1'),
      categoryId: portalLinkCategoryId('cat-1'),
      portalId: portalId('portal-1'),
      organizationId: organizationId('org-1'),
      label: 'Google Review',
      url: 'https://google.com/review',
      sortKey: 'a0',
      now,
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.label).toBe('Google Review')
      expect(result.value.url).toBe('https://google.com/review')
      expect(result.value.iconKey).toBeNull()
    }
  })

  it('accepts iconKey', () => {
    const result = buildPortalLink({
      id: portalLinkId('link-1'),
      categoryId: portalLinkCategoryId('cat-1'),
      portalId: portalId('portal-1'),
      organizationId: organizationId('org-1'),
      label: 'Test',
      url: 'https://example.com',
      iconKey: 'google',
      sortKey: 'a0',
      now,
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.iconKey).toBe('google')
    }
  })

  it('rejects invalid URL', () => {
    const result = buildPortalLink({
      id: portalLinkId('link-1'),
      categoryId: portalLinkCategoryId('cat-1'),
      portalId: portalId('portal-1'),
      organizationId: organizationId('org-1'),
      label: 'Test',
      url: 'not-a-url',
      sortKey: 'a0',
      now,
    })
    expect(result.isErr()).toBe(true)
  })

  it('rejects empty label', () => {
    const result = buildPortalLink({
      id: portalLinkId('link-1'),
      categoryId: portalLinkCategoryId('cat-1'),
      portalId: portalId('portal-1'),
      organizationId: organizationId('org-1'),
      label: '',
      url: 'https://example.com',
      sortKey: 'a0',
      now,
    })
    expect(result.isErr()).toBe(true)
  })
})
