import { describe, expect, it } from 'vitest'
import {
  PORTAL_PAGE_EDIT_KINDS,
  PORTAL_PAGE_EDIT_TEXT_MAX,
  clipPageEditText,
  describePageEdit,
  PORTAL_PAGE_EDIT_FOLD_WINDOW_MS,
  isPropertyWideEditKind,
  pageEditCarriesWording,
  portalPageEditKey,
  portalSettingField,
} from './portal-page-edit'

const ID = '3f0c2a0e-1111-4222-8333-444455556666'
const OTHER_ID = '9a1b2c3d-1111-4222-8333-444455556666'

describe('PORTAL_PAGE_EDIT_KINDS', () => {
  it('is the six kinds of change that can make a Portal page differ from what is live', () => {
    expect([...PORTAL_PAGE_EDIT_KINDS]).toEqual([
      'portal_configuration',
      'portal_links',
      'property_brand_profile',
      'property_brand_content',
      'portal_localized_override',
      'approved_destination',
    ])
  })
})

describe('isPropertyWideEditKind', () => {
  it.each([
    ['property_brand_profile', true],
    ['property_brand_content', true],
    ['portal_configuration', false],
    ['portal_links', false],
    ['portal_localized_override', false],
    ['approved_destination', false],
  ] as const)('%s -> %s', (kind, expected) => {
    expect(isPropertyWideEditKind(kind)).toBe(expected)
  })
})

describe('portalPageEditKey', () => {
  it('names the part of the page and the verb, with identifiers only', () => {
    expect(portalPageEditKey.categoryCreated(ID)).toBe(`category:${ID}:created`)
    expect(portalPageEditKey.categoryRenamed(ID)).toBe(`category:${ID}:renamed`)
    expect(portalPageEditKey.categoryDeleted(ID)).toBe(`category:${ID}:deleted`)
    expect(portalPageEditKey.categoriesReordered()).toBe('categories:reordered')
    expect(portalPageEditKey.linkCreated(ID)).toBe(`link:${ID}:created`)
    expect(portalPageEditKey.linkUpdated(ID)).toBe(`link:${ID}:updated`)
    expect(portalPageEditKey.linkDeleted(ID)).toBe(`link:${ID}:deleted`)
    expect(portalPageEditKey.linksReordered(ID)).toBe(`links:${ID}:reordered`)
    expect(portalPageEditKey.linkText(ID, 'es')).toBe(`link:${ID}:text:es`)
    expect(portalPageEditKey.linktreeTitle('bg')).toBe('linktree:title:bg')
    expect(portalPageEditKey.linktreeEnabled()).toBe('linktree:enabled')
    expect(portalPageEditKey.setting('hero_image')).toBe('settings:hero_image')
  })
})

describe('portalSettingField', () => {
  it.each([
    ['name', 'name'],
    ['slug', 'slug'],
    ['description', 'description'],
    ['heroImageUrl', 'hero_image'],
    ['theme', 'theme'],
    ['privateFeedbackThreshold', 'feedback_threshold'],
    ['primaryGuestLocale', 'primary_language'],
    ['additionalGuestLocales', 'additional_languages'],
  ] as const)('reads the working-copy field %s as %s', (patchKey, field) => {
    expect(portalSettingField(patchKey)).toBe(field)
  })

  it('has no setting for a key that is not a page setting', () => {
    expect(portalSettingField('publicationState')).toBeNull()
    expect(portalSettingField('updatedAt')).toBeNull()
  })
})

describe('clipPageEditText', () => {
  it('keeps short wording, clips long wording to the storage bound and leaves null alone', () => {
    expect(clipPageEditText('Dinner menu')).toBe('Dinner menu')
    expect(clipPageEditText(null)).toBeNull()
    expect(clipPageEditText(undefined)).toBeNull()
    const clipped = clipPageEditText('x'.repeat(PORTAL_PAGE_EDIT_TEXT_MAX + 50))
    expect(clipped).toHaveLength(PORTAL_PAGE_EDIT_TEXT_MAX)
    expect(clipped?.endsWith('\u2026')).toBe(true)
  })
})

describe('pageEditCarriesWording', () => {
  it.each([
    ['portal_links', `category:${ID}:renamed`, true],
    ['portal_links', `category:${ID}:created`, true],
    ['portal_links', `link:${ID}:updated`, true],
    ['portal_links', `link:${ID}:text:es`, true],
    ['portal_links', 'linktree:title:bg', true],
    ['portal_links', 'categories:reordered', false],
    ['portal_links', `links:${ID}:reordered`, false],
    ['portal_links', 'linktree:enabled', false],
    ['portal_configuration', 'settings:name', true],
    ['portal_configuration', 'settings:description', true],
    ['portal_configuration', 'settings:slug', false],
    ['portal_configuration', 'settings:theme', false],
    ['property_brand_profile', 'all', true],
    ['property_brand_profile', 'look:accent', false],
    ['property_brand_content', 'es', true],
    ['portal_localized_override', 'es', true],
    ['approved_destination', ID, false],
  ] as const)('%s / %s -> %s', (kind, key, expected) => {
    expect(pageEditCarriesWording(kind, key)).toBe(expected)
  })
})

describe('PORTAL_PAGE_EDIT_FOLD_WINDOW_MS', () => {
  it('is a few minutes, long enough for an autosaving editor and short enough to be one sitting', () => {
    expect(PORTAL_PAGE_EDIT_FOLD_WINDOW_MS).toBeGreaterThanOrEqual(60_000)
    expect(PORTAL_PAGE_EDIT_FOLD_WINDOW_MS).toBeLessThanOrEqual(30 * 60_000)
  })
})

describe('describePageEdit', () => {
  it.each([
    ['portal_configuration', 'all', { area: 'page_settings', field: null }],
    ['portal_configuration', 'settings:name', { area: 'page_settings', field: 'name' }],
    [
      'portal_configuration',
      'settings:additional_languages',
      { area: 'page_settings', field: 'additional_languages' },
    ],
    ['portal_links', 'all', { area: 'links' }],
    [
      'portal_links',
      `category:${ID}:created`,
      { area: 'category', categoryId: ID, change: 'created' },
    ],
    [
      'portal_links',
      `category:${ID}:renamed`,
      { area: 'category', categoryId: ID, change: 'renamed' },
    ],
    [
      'portal_links',
      `category:${ID}:deleted`,
      { area: 'category', categoryId: ID, change: 'deleted' },
    ],
    ['portal_links', 'categories:reordered', { area: 'categories_reordered' }],
    [
      'portal_links',
      `link:${ID}:created`,
      { area: 'link', linkId: ID, change: 'created' },
    ],
    [
      'portal_links',
      `link:${ID}:updated`,
      { area: 'link', linkId: ID, change: 'updated' },
    ],
    [
      'portal_links',
      `link:${ID}:deleted`,
      { area: 'link', linkId: ID, change: 'deleted' },
    ],
    [
      'portal_links',
      `links:${OTHER_ID}:reordered`,
      { area: 'links_reordered', categoryId: OTHER_ID },
    ],
    [
      'portal_links',
      `link:${ID}:text:es`,
      { area: 'link_text', linkId: ID, locale: 'es' },
    ],
    ['portal_links', 'linktree:enabled', { area: 'link_section_switch' }],
    ['portal_links', 'linktree:title:bg', { area: 'link_section_title', locale: 'bg' }],
    ['property_brand_profile', 'all', { area: 'display_name' }],
    ['property_brand_profile', 'look:accent', { area: 'look', facet: 'accent' }],
    ['property_brand_profile', 'look:images', { area: 'look', facet: 'images' }],
    ['property_brand_content', 'de', { area: 'welcome_text', locale: 'de' }],
    ['portal_localized_override', 'fr', { area: 'portal_text', locale: 'fr' }],
    ['approved_destination', ID, { area: 'destination', destinationId: ID }],
  ] as const)('reads %s / %s', (kind, key, expected) => {
    expect(describePageEdit(kind, key)).toEqual(expected)
  })

  it.each([
    ['portal_links', 'link:abc:text:xx', { area: 'links' }],
    ['portal_links', `link:${ID}:moved`, { area: 'links' }],
    ['portal_links', 'something:new', { area: 'links' }],
    ['property_brand_profile', 'look:sparkle', { area: 'look', facet: null }],
    ['property_brand_profile', 'font:serif', { area: 'profile' }],
    ['property_brand_content', 'xx', { area: 'welcome_text', locale: null }],
    ['portal_localized_override', 'all', { area: 'portal_text', locale: null }],
    ['approved_destination', 'all', { area: 'destination', destinationId: null }],
    ['portal_configuration', 'anything', { area: 'page_settings', field: null }],
    ['portal_configuration', 'settings:sparkle', { area: 'page_settings', field: null }],
  ] as const)(
    'falls back to the kind itself for a key it does not know, never to a wrong claim: %s / %s',
    (kind, key, expected) => {
      expect(describePageEdit(kind, key)).toEqual(expected)
    },
  )
})
