// Portal context — the page-edit ledger's vocabulary (round 4, slice 35b).
//
// Every change that can make a Portal's working page differ from what guests
// see is one of six kinds, the same six the pending-change fence names. The
// ledger records which kind, a key saying which part of the page and what was
// done to it, who did it and when. The key carries identifiers, locales and
// settings fields only; a change to one piece of wording also keeps that
// wording before and after (bounded, and only where the key says wording
// changed). This module writes keys (`portalPageEditKey`) and reads a
// (kind, key) pair back into the part of the page it names.

import { isGuestLocale, type GuestLocale } from '#/shared/domain/guest-locale'
import type { LookFacet } from './property-look'

export const PORTAL_PAGE_EDIT_KINDS = [
  'portal_configuration',
  'portal_links',
  'property_brand_profile',
  'property_brand_content',
  'portal_localized_override',
  'approved_destination',
] as const
export type PortalPageEditKind = (typeof PORTAL_PAGE_EDIT_KINDS)[number]

const PROPERTY_WIDE_KINDS: readonly PortalPageEditKind[] = [
  'property_brand_profile',
  'property_brand_content',
]

/**
 * The Property's look and welcome text belong to every Portal in it, so one
 * ledger row serves them all; every other kind belongs to one Portal.
 */
export const isPropertyWideEditKind = (kind: PortalPageEditKind): boolean =>
  PROPERTY_WIDE_KINDS.includes(kind)

/** The working-copy settings a page-settings edit can name. */
export const PORTAL_SETTING_FIELDS = [
  'name',
  'slug',
  'description',
  'hero_image',
  'theme',
  'feedback_threshold',
  'primary_language',
  'additional_languages',
] as const
export type PortalSettingField = (typeof PORTAL_SETTING_FIELDS)[number]

/** Portal working-copy field (as the update patch names it) to its ledger setting. */
const SETTING_BY_PATCH_KEY: Readonly<Record<string, PortalSettingField>> = {
  name: 'name',
  slug: 'slug',
  description: 'description',
  heroImageUrl: 'hero_image',
  theme: 'theme',
  privateFeedbackThreshold: 'feedback_threshold',
  primaryGuestLocale: 'primary_language',
  additionalGuestLocales: 'additional_languages',
}

/** The ledger setting for a working-copy patch key; null when it is not a page setting. */
export const portalSettingField = (patchKey: string): PortalSettingField | null =>
  Object.hasOwn(SETTING_BY_PATCH_KEY, patchKey)
    ? (SETTING_BY_PATCH_KEY[patchKey] ?? null)
    : null

/**
 * The keys of the `portal_links` and `portal_configuration` kinds. The fence
 * keeps its own coarse key (`all`); the ledger key says which part changed and
 * what was done to it.
 */
export const portalPageEditKey = {
  categoryCreated: (categoryId: string) => `category:${categoryId}:created`,
  categoryRenamed: (categoryId: string) => `category:${categoryId}:renamed`,
  categoryDeleted: (categoryId: string) => `category:${categoryId}:deleted`,
  categoriesReordered: () => 'categories:reordered',
  linkCreated: (linkId: string) => `link:${linkId}:created`,
  linkUpdated: (linkId: string) => `link:${linkId}:updated`,
  linkDeleted: (linkId: string) => `link:${linkId}:deleted`,
  linksReordered: (categoryId: string) => `links:${categoryId}:reordered`,
  linkText: (linkId: string, locale: string) => `link:${linkId}:text:${locale}`,
  linktreeTitle: (locale: string) => `linktree:title:${locale}`,
  linktreeEnabled: () => 'linktree:enabled',
  setting: (field: PortalSettingField) => `settings:${field}`,
} as const

/** The most wording the ledger keeps for one side of a change. */
export const PORTAL_PAGE_EDIT_TEXT_MAX = 200

/** Wording as the ledger keeps it: null stays null, long text is clipped with an ellipsis. */
export function clipPageEditText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return value.length <= PORTAL_PAGE_EDIT_TEXT_MAX
    ? value
    : `${value.slice(0, PORTAL_PAGE_EDIT_TEXT_MAX - 1)}\u2026`
}

/**
 * Whether a change of this kind and key is a change of wording, so its ledger
 * row may keep the text before and after. Looks, orders, switches and
 * destinations never do. The `portal_page_edits_text_scope` CHECK says the
 * same in SQL; the schema integration test pins the two together.
 */
export function pageEditCarriesWording(kind: PortalPageEditKind, key: string): boolean {
  switch (kind) {
    case 'property_brand_content':
    case 'portal_localized_override':
      return true
    case 'property_brand_profile':
      return key === 'all'
    case 'portal_links':
      return !key.endsWith('reordered') && key !== portalPageEditKey.linktreeEnabled()
    case 'portal_configuration':
      return (
        key === portalPageEditKey.setting('name') ||
        key === portalPageEditKey.setting('description')
      )
    case 'approved_destination':
      return false
  }
}

/**
 * Saves of the same part of the page by the same person fold into one ledger
 * row while they stay this close together and no publication separates them,
 * so an autosaving editor leaves one entry per sitting, not one per pause.
 */
export const PORTAL_PAGE_EDIT_FOLD_WINDOW_MS = 10 * 60_000

export type PortalPageEditSubject =
  | Readonly<{ area: 'page_settings'; field: PortalSettingField | null }>
  | Readonly<{ area: 'links' }>
  | Readonly<{
      area: 'category'
      categoryId: string
      change: 'created' | 'renamed' | 'deleted'
    }>
  | Readonly<{ area: 'categories_reordered' }>
  | Readonly<{
      area: 'link'
      linkId: string
      change: 'created' | 'updated' | 'deleted'
    }>
  | Readonly<{ area: 'links_reordered'; categoryId: string }>
  | Readonly<{ area: 'link_text'; linkId: string; locale: GuestLocale }>
  | Readonly<{ area: 'link_section_switch' }>
  | Readonly<{ area: 'link_section_title'; locale: GuestLocale }>
  | Readonly<{ area: 'display_name' }>
  | Readonly<{ area: 'look'; facet: LookFacet | null }>
  | Readonly<{ area: 'profile' }>
  | Readonly<{ area: 'welcome_text'; locale: GuestLocale | null }>
  | Readonly<{ area: 'portal_text'; locale: GuestLocale | null }>
  | Readonly<{ area: 'destination'; destinationId: string | null }>

const LOOK_FACETS: readonly LookFacet[] = [
  'accent',
  'field',
  'text',
  'wordmark',
  'images',
]
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const LINK_TEXT_KEY = new RegExp(`^link:(${UUID}):text:([a-z]{2,3})$`)
const LINK_KEY = new RegExp(`^link:(${UUID}):(created|updated|deleted)$`)
const CATEGORY_KEY = new RegExp(`^category:(${UUID}):(created|renamed|deleted)$`)
const LINKS_REORDERED_KEY = new RegExp(`^links:(${UUID}):reordered$`)
const LINKTREE_TITLE_KEY = /^linktree:title:([a-z]{2,3})$/
const ID_KEY = new RegExp(`^${UUID}$`)

const localeOrNull = (value: string | undefined): GuestLocale | null =>
  value !== undefined && isGuestLocale(value) ? value : null

function describeLinksEdit(key: string): PortalPageEditSubject {
  if (key === portalPageEditKey.linktreeEnabled()) return { area: 'link_section_switch' }
  if (key === portalPageEditKey.categoriesReordered()) {
    return { area: 'categories_reordered' }
  }
  const text = LINK_TEXT_KEY.exec(key)
  const textLocale = localeOrNull(text?.[2])
  if (text?.[1] !== undefined && textLocale !== null) {
    return { area: 'link_text', linkId: text[1], locale: textLocale }
  }
  const titleLocale = localeOrNull(LINKTREE_TITLE_KEY.exec(key)?.[1])
  if (titleLocale !== null) return { area: 'link_section_title', locale: titleLocale }
  const link = LINK_KEY.exec(key)
  if (link?.[1] !== undefined && link[2] !== undefined) {
    return {
      area: 'link',
      linkId: link[1],
      change: link[2] as 'created' | 'updated' | 'deleted',
    }
  }
  const category = CATEGORY_KEY.exec(key)
  if (category?.[1] !== undefined && category[2] !== undefined) {
    return {
      area: 'category',
      categoryId: category[1],
      change: category[2] as 'created' | 'renamed' | 'deleted',
    }
  }
  const reordered = LINKS_REORDERED_KEY.exec(key)?.[1]
  if (reordered !== undefined) return { area: 'links_reordered', categoryId: reordered }
  return { area: 'links' }
}

function describeSettingsEdit(key: string): PortalPageEditSubject {
  const field = PORTAL_SETTING_FIELDS.find(
    (candidate) => key === portalPageEditKey.setting(candidate),
  )
  return { area: 'page_settings', field: field ?? null }
}

function describeProfileEdit(key: string): PortalPageEditSubject {
  if (key === 'all') return { area: 'display_name' }
  if (!key.startsWith('look:')) return { area: 'profile' }
  const facet = LOOK_FACETS.find((candidate) => key === `look:${candidate}`)
  return { area: 'look', facet: facet ?? null }
}

/**
 * What part of the page a ledger row names. A key this code does not know
 * reads as its kind's general area, never as an error and never as a wrong
 * claim: the ledger outlives the code that wrote it.
 */
export function describePageEdit(
  kind: PortalPageEditKind,
  key: string,
): PortalPageEditSubject {
  switch (kind) {
    case 'portal_configuration':
      return describeSettingsEdit(key)
    case 'portal_links':
      return describeLinksEdit(key)
    case 'property_brand_profile':
      return describeProfileEdit(key)
    case 'property_brand_content':
      return { area: 'welcome_text', locale: localeOrNull(key) }
    case 'portal_localized_override':
      return { area: 'portal_text', locale: localeOrNull(key) }
    case 'approved_destination':
      return { area: 'destination', destinationId: ID_KEY.test(key) ? key : null }
  }
}
