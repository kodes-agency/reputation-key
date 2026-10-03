// Portal context — link tree server function tests
// Tests DTO schema validation used by the link server functions.

import { describe, it, expect } from 'vitest'
import {
  createLinkInputSchema,
  updateLinkInputSchema,
  reorderLinksInputSchema,
} from '#/contexts/portal/application/dto/portal-link.dto'
import {
  saveLinktreeSettingsInputSchema,
  savePortalLinkTextsInputSchema,
} from '#/contexts/portal/application/dto/portal-linktree.dto'

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
      iconKey: 'globe',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an iconKey outside the closed icon set', () => {
    const result = createLinkInputSchema.safeParse({
      categoryId: 'cat-123',
      portalId: 'portal-123',
      label: 'Google Review',
      url: 'https://google.com/review',
      iconKey: 'google',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a missing categoryId: the link joins the last category', () => {
    const result = createLinkInputSchema.safeParse({
      portalId: 'portal-123',
      label: 'Google Review',
      url: 'https://google.com/review',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an empty categoryId', () => {
    const result = createLinkInputSchema.safeParse({
      categoryId: '',
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

  it('rejects an iconKey outside the closed icon set', () => {
    const result = updateLinkInputSchema.safeParse({
      linkId: 'link-123',
      iconKey: 'not-an-icon',
    })
    expect(result.success).toBe(false)
  })

  it('accepts the id of an uploaded picture, or null to take it off', () => {
    const picture = '30000000-0000-4000-8000-000000000001'
    expect(
      updateLinkInputSchema.safeParse({ linkId: 'link-123', imageAssetId: picture })
        .success,
    ).toBe(true)
    expect(
      updateLinkInputSchema.safeParse({ linkId: 'link-123', imageAssetId: null }).success,
    ).toBe(true)
  })

  it('rejects a picture id that is not a UUID', () => {
    expect(
      updateLinkInputSchema.safeParse({ linkId: 'link-123', imageAssetId: 'abc' })
        .success,
    ).toBe(false)
  })

  it('rejects missing linkId', () => {
    const result = updateLinkInputSchema.safeParse({
      label: 'Updated',
    })
    expect(result.success).toBe(false)
  })
})

describe('savePortalLinkTexts input validation', () => {
  const valid = {
    linkId: 'link-123',
    texts: [{ locale: 'en', label: 'Menu', line: 'Open all day' }],
  }

  it('accepts a label with or without a line', () => {
    expect(savePortalLinkTextsInputSchema.safeParse(valid).success).toBe(true)
    expect(
      savePortalLinkTextsInputSchema.safeParse({
        linkId: 'link-123',
        texts: [{ locale: 'bg', label: 'Меню' }],
      }).success,
    ).toBe(true)
  })

  it('takes the languages managers may offer today, German included', () => {
    expect(
      savePortalLinkTextsInputSchema.safeParse({
        linkId: 'link-123',
        texts: [{ locale: 'de', label: 'Speisekarte' }],
      }).success,
    ).toBe(true)
  })

  it('refuses a language that is not a guest language', () => {
    expect(
      savePortalLinkTextsInputSchema.safeParse({
        linkId: 'link-123',
        texts: [{ locale: 'pt', label: 'Cardápio' }],
      }).success,
    ).toBe(false)
  })

  it('takes no provenance: what a manager saves is theirs', () => {
    const parsed = savePortalLinkTextsInputSchema.safeParse({
      linkId: 'link-123',
      texts: [{ locale: 'en', label: 'Menu', provenance: 'ai_draft' }],
    })
    expect(parsed.success && 'provenance' in parsed.data.texts[0]!).toBe(false)
  })

  it.each([
    ['no texts', { linkId: 'link-123', texts: [] }],
    ['a missing linkId', { texts: valid.texts }],
    [
      'more texts than languages',
      {
        linkId: 'link-123',
        texts: Array.from({ length: 7 }, () => ({ locale: 'en', label: 'Menu' })),
      },
    ],
  ])('rejects %s', (_name, input) => {
    expect(savePortalLinkTextsInputSchema.safeParse(input).success).toBe(false)
  })
})

describe('saveLinktreeSettings input validation', () => {
  it('accepts the switch, titles, or both', () => {
    expect(
      saveLinktreeSettingsInputSchema.safeParse({ portalId: 'p-1', enabled: false })
        .success,
    ).toBe(true)
    expect(
      saveLinktreeSettingsInputSchema.safeParse({
        portalId: 'p-1',
        titles: [{ locale: 'en', title: 'Around town' }],
      }).success,
    ).toBe(true)
    expect(
      saveLinktreeSettingsInputSchema.safeParse({
        portalId: 'p-1',
        enabled: true,
        titles: [{ locale: 'bg', title: null }],
      }).success,
    ).toBe(true)
  })

  it('refuses a call that changes nothing, and a missing portalId', () => {
    expect(saveLinktreeSettingsInputSchema.safeParse({ portalId: 'p-1' }).success).toBe(
      false,
    )
    expect(saveLinktreeSettingsInputSchema.safeParse({ enabled: true }).success).toBe(
      false,
    )
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
