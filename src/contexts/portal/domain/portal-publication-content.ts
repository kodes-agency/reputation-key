// Portal context — what a publication snapshot shows guests, and how two of
// them differ (round 4, slice 36).
//
// The History tab says what each version added and what "Make live again"
// would change back for guests. Both come from one pure comparison of two
// immutable snapshot configurations. A configuration is one of three shapes
// (v1 legacy, v2 localized, v3 Immersive Hub) and snapshots of every shape
// stay readable forever, so this module first reads each into one neutral view
// and then compares views. A part a shape does not carry is simply absent from
// its view, never invented.
//
// A change names the part of the page and the wording a manager would
// recognise (a tile's label, a language). It is a read model for the people who
// manage the Portal, not an event: nothing here is ever published as a fact.

import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  IMMERSIVE_HUB_SCHEMA_VERSION,
  isLocalizedConfiguration,
  type PortalPublicationConfiguration,
} from './portal-publication-snapshot'

export type PublicationLinkView = Readonly<{
  id: string
  /** The label in the primary language. */
  label: string
  address: string
  /** Whether the tile carries a photo (only the Immersive Hub has them). */
  hasPhoto: boolean
  /** Per language: the label and the line under it. Present for v3 only. */
  texts: Readonly<
    Partial<Record<GuestLocale, Readonly<{ label: string; line: string | null }>>>
  >
}>

export type PublicationContentView = Readonly<{
  schemaVersion: number
  surface: 'legacy' | 'immersive'
  primaryLocale: GuestLocale
  locales: readonly GuestLocale[]
  /** Guest order: category then link for the legacy page, array order for v3. */
  links: readonly PublicationLinkView[]
  /** Null where the schema has no switch: the section shows whenever it has links. */
  linktreeEnabled: boolean | null
  wording: Readonly<
    Partial<Record<GuestLocale, Readonly<{ title: string; description: string }>>>
  >
  /** v3 only: the line that describes the hero photo, and the section's title. */
  photoDescriptions: Readonly<Partial<Record<GuestLocale, string>>>
  linktreeTitles: Readonly<Partial<Record<GuestLocale, string>>>
  look: Readonly<{
    name: string | null
    colours: string
    wordmark: string | null
    logo: string | null
    photo: string | null
  }>
  feedbackThreshold: number
  reviewAddress: string
}>

const legacyLinks = (
  configuration: Extract<PortalPublicationConfiguration, { schemaVersion: 1 | 2 }>,
): readonly PublicationLinkView[] => {
  const categoryOrder = new Map(
    [...configuration.categories]
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
      .map((category, index) => [category.id, index]),
  )
  const rank = (categoryId: string | null) =>
    categoryId === null
      ? Number.MAX_SAFE_INTEGER
      : (categoryOrder.get(categoryId) ?? Number.MAX_SAFE_INTEGER)
  return [...configuration.links]
    .sort(
      (a, b) =>
        rank(a.categoryId) - rank(b.categoryId) ||
        (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0),
    )
    .map((link) => ({
      id: link.id,
      label: link.label,
      address: link.url,
      hasPhoto: false,
      texts: {},
    }))
}

function immersiveView(
  configuration: Extract<PortalPublicationConfiguration, { schemaVersion: 3 }>,
): PublicationContentView {
  const { guestLocale, localizedContent, brandProfile } = configuration
  const entries = Object.entries(localizedContent) as ReadonlyArray<
    [GuestLocale, (typeof localizedContent)[GuestLocale] & object]
  >
  return {
    schemaVersion: configuration.schemaVersion,
    surface: 'immersive',
    primaryLocale: guestLocale,
    locales: configuration.localeSet,
    links: configuration.links.map((link) => ({
      id: link.id,
      label: link.texts[guestLocale]?.label ?? '',
      address: link.url,
      hasPhoto: link.imageAssetId !== null,
      texts: Object.fromEntries(
        Object.entries(link.texts).flatMap(([locale, text]) =>
          text ? [[locale, { label: text.label, line: text.line }]] : [],
        ),
      ),
    })),
    linktreeEnabled: configuration.linktree.enabled,
    wording: Object.fromEntries(
      entries.map(([locale, content]) => [
        locale,
        { title: content.title.value, description: content.shortDescription.value },
      ]),
    ),
    photoDescriptions: Object.fromEntries(
      entries.map(([locale, content]) => [locale, content.heroAlt.value]),
    ),
    linktreeTitles: Object.fromEntries(
      entries.map(([locale, content]) => [locale, content.linktreeTitle.value]),
    ),
    look: {
      name: brandProfile.displayName,
      colours: `${brandProfile.accentColour}/${brandProfile.fieldColour}`,
      wordmark: brandProfile.wordmark,
      logo: brandProfile.logo?.assetId ?? null,
      photo: brandProfile.hero?.assetId ?? null,
    },
    feedbackThreshold: configuration.reviewGateway.privateFeedbackThreshold,
    reviewAddress: configuration.reviewGateway.googleReview.uri,
  }
}

function localizedView(
  configuration: Extract<PortalPublicationConfiguration, { schemaVersion: 1 | 2 }>,
): PublicationContentView {
  const base = {
    schemaVersion: configuration.schemaVersion,
    surface: 'legacy',
    links: legacyLinks(configuration),
    linktreeEnabled: null,
    photoDescriptions: {},
    linktreeTitles: {},
    feedbackThreshold: configuration.reviewGateway.privateFeedbackThreshold,
    reviewAddress: configuration.reviewGateway.googleReview.uri,
  } as const
  if (!isLocalizedConfiguration(configuration)) {
    const colour = configuration.portal.theme?.primaryColor
    return {
      ...base,
      primaryLocale: configuration.guestLocale,
      locales: [configuration.guestLocale],
      wording: {
        [configuration.guestLocale]: {
          title: configuration.portal.name,
          description: configuration.portal.description ?? '',
        },
      },
      look: {
        name: null,
        colours: typeof colour === 'string' ? colour : '',
        wordmark: null,
        logo: null,
        photo: configuration.portal.heroImageUrl,
      },
    }
  }
  const { brandProfile } = configuration
  return {
    ...base,
    primaryLocale: configuration.guestLocale,
    locales: configuration.localeSet,
    wording: Object.fromEntries(
      Object.entries(configuration.localizedContent).flatMap(([locale, content]) =>
        content
          ? [[locale, { title: content.title, description: content.shortDescription }]]
          : [],
      ),
    ),
    look: {
      name: brandProfile.displayName,
      colours: `${brandProfile.primaryColor}/${brandProfile.backgroundColor}/${brandProfile.textColor}`,
      wordmark: null,
      logo: brandProfile.logoUrl,
      photo: brandProfile.defaultHeroImageUrl,
    },
  }
}

/** What a configuration shows guests, in one shape for every schema version. */
export function publicationContentView(
  configuration: PortalPublicationConfiguration,
): PublicationContentView {
  return configuration.schemaVersion >= IMMERSIVE_HUB_SCHEMA_VERSION
    ? immersiveView(configuration as Extract<typeof configuration, { schemaVersion: 3 }>)
    : localizedView(
        configuration as Extract<typeof configuration, { schemaVersion: 1 | 2 }>,
      )
}

// ── changes ───────────────────────────────────────────────────────────────

export type PublicationLookFacet = 'colours' | 'name' | 'wordmark' | 'logo' | 'photo'
export type PublicationWordingField =
  'title' | 'description' | 'photo_description' | 'linktree_title'

/**
 * One difference between two configurations. `added` and `removed` are from
 * the point of view of the later one: it has the part and the earlier one does
 * not (or the reverse). Labels are the primary-language wording, as a manager
 * knows the tile.
 */
export type PublicationContentChange =
  | Readonly<{ kind: 'language_added'; locale: GuestLocale }>
  | Readonly<{ kind: 'language_removed'; locale: GuestLocale }>
  | Readonly<{
      kind: 'primary_language_changed'
      from: GuestLocale
      to: GuestLocale
    }>
  | Readonly<{ kind: 'link_added'; label: string; hasPhoto: boolean }>
  | Readonly<{ kind: 'link_removed'; label: string; hasPhoto: boolean }>
  | Readonly<{ kind: 'link_renamed'; from: string; to: string }>
  | Readonly<{ kind: 'link_address_changed'; label: string }>
  | Readonly<{ kind: 'link_reworded'; label: string; locale: GuestLocale }>
  | Readonly<{ kind: 'links_reordered' }>
  | Readonly<{ kind: 'linktree_switched'; enabled: boolean }>
  | Readonly<{
      kind: 'wording_changed'
      field: PublicationWordingField
      locale: GuestLocale
    }>
  | Readonly<{ kind: 'look_changed'; facets: readonly PublicationLookFacet[] }>
  | Readonly<{ kind: 'design_changed'; to: 'immersive' | 'legacy' }>
  | Readonly<{ kind: 'feedback_threshold_changed'; from: number; to: number }>
  | Readonly<{ kind: 'review_address_changed' }>

const changedLocales = (
  before: ReadonlyArray<GuestLocale>,
  after: ReadonlyArray<GuestLocale>,
): ReadonlyArray<PublicationContentChange> => [
  ...after
    .filter((locale) => !before.includes(locale))
    .map((locale): PublicationContentChange => ({ kind: 'language_added', locale })),
  ...before
    .filter((locale) => !after.includes(locale))
    .map((locale): PublicationContentChange => ({ kind: 'language_removed', locale })),
]

function changedLinks(
  before: PublicationContentView,
  after: PublicationContentView,
): ReadonlyArray<PublicationContentChange> {
  const was = new Map(before.links.map((link) => [link.id, link]))
  const now = new Map(after.links.map((link) => [link.id, link]))
  const changes: PublicationContentChange[] = [
    ...after.links
      .filter((link) => !was.has(link.id))
      .map((link): PublicationContentChange => ({
        kind: 'link_added',
        label: link.label,
        hasPhoto: link.hasPhoto,
      })),
    ...before.links
      .filter((link) => !now.has(link.id))
      .map((link): PublicationContentChange => ({
        kind: 'link_removed',
        label: link.label,
        hasPhoto: link.hasPhoto,
      })),
  ]
  for (const link of after.links) {
    const earlier = was.get(link.id)
    if (!earlier) continue
    if (earlier.label !== link.label) {
      changes.push({ kind: 'link_renamed', from: earlier.label, to: link.label })
    }
    if (earlier.address !== link.address) {
      changes.push({ kind: 'link_address_changed', label: link.label })
    }
    for (const locale of after.locales) {
      const [wasText, nowText] = [earlier.texts[locale], link.texts[locale]]
      if (!wasText || !nowText) continue
      // A new primary-language label is already reported as a rename.
      const labelChanged =
        wasText.label !== nowText.label && locale !== after.primaryLocale
      if (labelChanged || wasText.line !== nowText.line) {
        changes.push({ kind: 'link_reworded', label: link.label, locale })
      }
    }
  }
  const shared = (view: PublicationContentView, other: Map<string, unknown>) =>
    view.links.filter((link) => other.has(link.id)).map((link) => link.id)
  if (shared(before, now).join() !== shared(after, was).join()) {
    changes.push({ kind: 'links_reordered' })
  }
  return changes
}

function changedWording(
  before: PublicationContentView,
  after: PublicationContentView,
): ReadonlyArray<PublicationContentChange> {
  const common = after.locales.filter((locale) => before.locales.includes(locale))
  return common.flatMap((locale) => {
    const fields: ReadonlyArray<
      readonly [PublicationWordingField, string | undefined, string | undefined]
    > = [
      ['title', before.wording[locale]?.title, after.wording[locale]?.title],
      [
        'description',
        before.wording[locale]?.description,
        after.wording[locale]?.description,
      ],
      [
        'photo_description',
        before.photoDescriptions[locale],
        after.photoDescriptions[locale],
      ],
      ['linktree_title', before.linktreeTitles[locale], after.linktreeTitles[locale]],
    ]
    return fields.flatMap(([field, was, now]): PublicationContentChange[] =>
      was !== undefined && now !== undefined && was !== now
        ? [{ kind: 'wording_changed', field, locale }]
        : [],
    )
  })
}

function changedLook(
  before: PublicationContentView,
  after: PublicationContentView,
): ReadonlyArray<PublicationContentChange> {
  if (before.surface !== after.surface) {
    return [{ kind: 'design_changed', to: after.surface }]
  }
  // Each schema keeps its own look facts (a v1 has only a primary colour), so
  // a look is compared only against a look of the same shape.
  if (before.schemaVersion !== after.schemaVersion) return []
  const facets = (['colours', 'name', 'wordmark', 'logo', 'photo'] as const).filter(
    (facet) => before.look[facet] !== after.look[facet],
  )
  return facets.length === 0 ? [] : [{ kind: 'look_changed', facets }]
}

/**
 * What differs between two snapshot configurations, as the guest page would
 * show it. `before` null stands for no earlier version: everything is added.
 * Parts a configuration cannot tell (a v1 has no name for the brand, a v2 no
 * switch for the section) are never reported as changed. Empty when nothing a
 * guest could see differs.
 */
export function diffPublicationContent(
  before: PortalPublicationConfiguration | null,
  after: PortalPublicationConfiguration,
): ReadonlyArray<PublicationContentChange> {
  const next = publicationContentView(after)
  if (before === null) {
    return [
      ...changedLocales([], next.locales),
      ...next.links.map((link): PublicationContentChange => ({
        kind: 'link_added',
        label: link.label,
        hasPhoto: link.hasPhoto,
      })),
    ]
  }
  const prior = publicationContentView(before)
  const switched =
    (prior.linktreeEnabled ?? true) !== (next.linktreeEnabled ?? true)
      ? [{ kind: 'linktree_switched', enabled: next.linktreeEnabled ?? true } as const]
      : []
  return [
    ...(prior.primaryLocale !== next.primaryLocale
      ? [
          {
            kind: 'primary_language_changed',
            from: prior.primaryLocale,
            to: next.primaryLocale,
          } as const,
        ]
      : []),
    ...changedLocales(prior.locales, next.locales),
    ...changedLinks(prior, next),
    ...switched,
    ...changedWording(prior, next),
    ...changedLook(prior, next),
    ...(prior.feedbackThreshold !== next.feedbackThreshold
      ? [
          {
            kind: 'feedback_threshold_changed',
            from: prior.feedbackThreshold,
            to: next.feedbackThreshold,
          } as const,
        ]
      : []),
    ...(prior.reviewAddress !== next.reviewAddress
      ? [{ kind: 'review_address_changed' } as const]
      : []),
  ]
}
