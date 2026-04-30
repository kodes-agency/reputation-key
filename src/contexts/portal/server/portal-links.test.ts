// Portal context — link tree server function tests
// Tests DTO schema validation used by link category/link server functions.

import { describe, it, expect } from 'vitest'
import {
  createLinkCategoryInputSchema,
  updateLinkCategoryInputSchema,
  reorderCategoriesInputSchema,
} from '#/contexts/portal/application/dto/portal-link-category.dto'
import {
  createLinkInputSchema,
  updateLinkInputSchema,
  reorderLinksInputSchema,
} from '#/contexts/portal/application/dto/portal-link.dto'

// ── Category DTO validation ────────────────────────────────────────

describe('createLinkCategory input validation', () => {
  it('accepts valid input', () => {
    const result = createLinkCategoryInputSchema.safeParse({
      portalId: 'portal-123',
      title: 'Reviews',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing portalId', () => {
    const result = createLinkCategoryInputSchema.safeParse({
      title: 'Reviews',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing title', () => {
    const result = createLinkCategoryInputSchema.safeParse({
      portalId: 'portal-123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty title', () => {
    const result = createLinkCategoryInputSchema.safeParse({
      portalId: 'portal-123',
      title: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects title over 100 characters', () => {
    const result = createLinkCategoryInputSchema.safeParse({
      portalId: 'portal-123',
      title: 'a'.repeat(101),
    })
    expect(result.success).toBe(false)
  })
})

describe('updateLinkCategory input validation', () => {
  it('accepts valid input', () => {
    const result = updateLinkCategoryInputSchema.safeParse({
      categoryId: 'cat-123',
      title: 'Updated Title',
    })
    expect(result.success).toBe(true)
  })

  it('accepts categoryId only', () => {
    const result = updateLinkCategoryInputSchema.safeParse({
      categoryId: 'cat-123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing categoryId', () => {
    const result = updateLinkCategoryInputSchema.safeParse({
      title: 'Updated',
    })
    expect(result.success).toBe(false)
  })
})

describe('reorderCategories input validation', () => {
  it('accepts valid input', () => {
    const result = reorderCategoriesInputSchema.safeParse({
      portalId: 'portal-123',
      items: [
        { id: 'cat-1', sortKey: 'a0' },
        { id: 'cat-2', sortKey: 'a1' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty items array', () => {
    const result = reorderCategoriesInputSchema.safeParse({
      portalId: 'portal-123',
      items: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing portalId', () => {
    const result = reorderCategoriesInputSchema.safeParse({
      items: [{ id: 'cat-1', sortKey: 'a0' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects item with empty id', () => {
    const result = reorderCategoriesInputSchema.safeParse({
      portalId: 'portal-123',
      items: [{ id: '', sortKey: 'a0' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects item with empty sortKey', () => {
    const result = reorderCategoriesInputSchema.safeParse({
      portalId: 'portal-123',
      items: [{ id: 'cat-1', sortKey: '' }],
    })
    expect(result.success).toBe(false)
  })
})

// ── Link DTO validation ────────────────────────────────────────────

describe('createLink input validation', () => {
  it('accepts valid input', () => {
    const result = createLinkInputSchema.safeParse({
      categoryId: 'cat-123',
      portalId: 'portal-123',
      label: 'Google Review',
      url: 'https://google.com/review',
    })
    expect(result.success).toBe(true)
  })

  it('accepts input with iconKey', () => {
    const result = createLinkInputSchema.safeParse({
      categoryId: 'cat-123',
      portalId: 'portal-123',
      label: 'Google Review',
      url: 'https://google.com/review',
      iconKey: 'google',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing categoryId', () => {
    const result = createLinkInputSchema.safeParse({
      portalId: 'portal-123',
      label: 'Google Review',
      url: 'https://google.com/review',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing portalId', () => {
    const result = createLinkInputSchema.safeParse({
      categoryId: 'cat-123',
      label: 'Google Review',
      url: 'https://google.com/review',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty label', () => {
    const result = createLinkInputSchema.safeParse({
      categoryId: 'cat-123',
      portalId: 'portal-123',
      label: '',
      url: 'https://google.com/review',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty url', () => {
    const result = createLinkInputSchema.safeParse({
      categoryId: 'cat-123',
      portalId: 'portal-123',
      label: 'Google Review',
      url: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects label over 100 characters', () => {
    const result = createLinkInputSchema.safeParse({
      categoryId: 'cat-123',
      portalId: 'portal-123',
      label: 'a'.repeat(101),
      url: 'https://example.com',
    })
    expect(result.success).toBe(false)
  })

  it('rejects url over 500 characters', () => {
    const result = createLinkInputSchema.safeParse({
      categoryId: 'cat-123',
      portalId: 'portal-123',
      label: 'Test',
      url: 'https://example.com/' + 'a'.repeat(500),
    })
    expect(result.success).toBe(false)
  })
})

describe('updateLink input validation', () => {
  it('accepts valid input', () => {
    const result = updateLinkInputSchema.safeParse({
      linkId: 'link-123',
      label: 'Updated Label',
      url: 'https://updated.com',
    })
    expect(result.success).toBe(true)
  })

  it('accepts linkId only', () => {
    const result = updateLinkInputSchema.safeParse({
      linkId: 'link-123',
    })
    expect(result.success).toBe(true)
  })

  it('accepts null iconKey (to clear it)', () => {
    const result = updateLinkInputSchema.safeParse({
      linkId: 'link-123',
      iconKey: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing linkId', () => {
    const result = updateLinkInputSchema.safeParse({
      label: 'Updated',
    })
    expect(result.success).toBe(false)
  })
})

describe('reorderLinks input validation', () => {
  it('accepts valid input', () => {
    const result = reorderLinksInputSchema.safeParse({
      categoryId: 'cat-123',
      portalId: 'portal-123',
      items: [
        { id: 'link-1', sortKey: 'a0' },
        { id: 'link-2', sortKey: 'a1' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty items array', () => {
    const result = reorderLinksInputSchema.safeParse({
      categoryId: 'cat-123',
      portalId: 'portal-123',
      items: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing categoryId', () => {
    const result = reorderLinksInputSchema.safeParse({
      portalId: 'portal-123',
      items: [{ id: 'link-1', sortKey: 'a0' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing portalId', () => {
    const result = reorderLinksInputSchema.safeParse({
      categoryId: 'cat-123',
      items: [{ id: 'link-1', sortKey: 'a0' }],
    })
    expect(result.success).toBe(false)
  })
})
