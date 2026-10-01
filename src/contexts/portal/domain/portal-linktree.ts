// Portal context — the Linktree working model: how many links a Portal may
// carry, the per-language texts of a link, and the editable section title.
//
// Pure: no I/O, no throws. Validation returns Result. The rows live in
// `portal_link_texts` and `portal_localized_overrides.linktree_title`; the
// legacy `portal_links.label` is kept in step for the primary language until
// the v3 writer has been live long enough to drop it.

import { GUEST_LOCALES, type GuestLocale } from '#/shared/domain/guest-locale'
import { err, ok } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import { portalError, type PortalError } from './errors'

/** A Portal carries at most this many links; portals that already have more keep them. */
export const MAX_PORTAL_LINKS = 4

// A section title the manager has not written is null, never a stored default:
// readers show the guest language pack's `linktreeDefaultTitle` (the v2 packs
// translate it), so there is one source for the default wording.

/**
 * The wording a Portal's Linktree title has while a manager has not written one:
 * the language packs' `linktreeDefaultTitle`, pinned here because the portal
 * context cannot import the guest components. A test holds each entry to the
 * pack's own wording.
 */
const LINKTREE_DEFAULT_TITLES: Readonly<Record<GuestLocale, string>> = Object.freeze({
  en: 'Useful links',
  es: 'Enlaces útiles',
  it: 'Link utili',
  fr: 'Liens utiles',
  de: 'Nützliche Links',
  bg: 'Полезни връзки',
})

export const linktreeDefaultTitle = (locale: GuestLocale): string =>
  LINKTREE_DEFAULT_TITLES[locale]

/**
 * The title of the one category a Portal's links sit in once the editor no
 * longer shows categories. Publishing flattens categories, so no guest ever
 * reads it and no language needs its wording; it exists because a category row
 * must have a title.
 */
export const STARTED_CATEGORY_TITLE = 'Links'

/** Equal to the legacy `portal_links.label` column, which the primary text is mirrored into. */
export const LINK_TEXT_LABEL_MAX_LENGTH = 100
export const LINK_TEXT_LINE_MAX_LENGTH = 160
export const LINKTREE_TITLE_MAX_LENGTH = 60

/** Where a text came from, when it was not typed by a manager. Null means manager-written. */
export type PortalLinkTextProvenance = 'ai_draft'

export type LinkTextInput = Readonly<{
  locale: GuestLocale
  label: string
  line?: string | null
  provenance?: PortalLinkTextProvenance | null
}>

export type ValidLinkText = Readonly<{
  locale: GuestLocale
  label: string
  line: string | null
  provenance: PortalLinkTextProvenance | null
}>

/** A `portal_link_texts` row as the reader sees it. */
export type StoredPortalLinkText = Readonly<{
  linkId: string
  locale: GuestLocale
  label: string
  line: string | null
  provenance: PortalLinkTextProvenance | null
  version: number
  updatedBy: string
  updatedAt: Date
}>

/**
 * A text after the legacy fallback: `text` rows come from `portal_link_texts`,
 * `legacy_label` rows are the link's own label standing in for a primary-locale
 * row that does not exist (a link written before the table existed).
 */
export type ResolvedPortalLinkText = Omit<StoredPortalLinkText, 'updatedBy'> &
  Readonly<{
    updatedBy: string | null
    source: 'text' | 'legacy_label'
  }>

export const hasRoomForAnotherLink = (existingLinkCount: number): boolean =>
  existingLinkCount < MAX_PORTAL_LINKS

export const validateLinkTextInput = (
  input: LinkTextInput,
): Result<ValidLinkText, PortalError> => {
  const label = input.label.trim()
  if (label.length < 1) {
    return err(portalError('invalid_label', 'Link label is required'))
  }
  if (label.length > LINK_TEXT_LABEL_MAX_LENGTH) {
    return err(
      portalError(
        'invalid_label',
        `Link label must be at most ${LINK_TEXT_LABEL_MAX_LENGTH} characters`,
      ),
    )
  }
  const line = input.line?.trim() ?? ''
  if (line.length > LINK_TEXT_LINE_MAX_LENGTH) {
    return err(
      portalError(
        'invalid_label',
        `Link line must be at most ${LINK_TEXT_LINE_MAX_LENGTH} characters`,
      ),
    )
  }
  return ok({
    locale: input.locale,
    label,
    line: line.length > 0 ? line : null,
    provenance: input.provenance ?? null,
  })
}

/** Null or blank resets the title to the default; a title is otherwise trimmed and bounded. */
export const validateLinktreeTitle = (
  value: string | null,
): Result<string | null, PortalError> => {
  const title = value?.trim() ?? ''
  if (title.length === 0) return ok(null)
  if (title.length > LINKTREE_TITLE_MAX_LENGTH) {
    return err(
      portalError(
        'invalid_title',
        `Linktree title must be at most ${LINKTREE_TITLE_MAX_LENGTH} characters`,
      ),
    )
  }
  return ok(title)
}

/**
 * Every text of every link, in link order then language order (primary first).
 * A link with no primary-language row gets its legacy label as that row, so
 * nothing that reads texts ever sees a link without a name. The label is only a
 * fallback for a link written before the texts existed: nothing writes it any
 * more, so a stored text always wins over it.
 */
export function resolveLinkTexts(
  input: Readonly<{
    links: ReadonlyArray<Readonly<{ id: string; label: string }>>
    texts: ReadonlyArray<StoredPortalLinkText>
    primaryLocale: GuestLocale
  }>,
): ReadonlyArray<ResolvedPortalLinkText> {
  const localeRank = (locale: GuestLocale): number =>
    locale === input.primaryLocale ? -1 : GUEST_LOCALES.indexOf(locale)
  return input.links.flatMap((link) => {
    const own = input.texts
      .filter((text) => text.linkId === link.id)
      .map((text): ResolvedPortalLinkText => ({ ...text, source: 'text' }))
    const hasPrimary = own.some((text) => text.locale === input.primaryLocale)
    const fallback: ReadonlyArray<ResolvedPortalLinkText> = hasPrimary
      ? []
      : [
          {
            linkId: link.id,
            locale: input.primaryLocale,
            label: link.label,
            line: null,
            provenance: null,
            version: 0,
            updatedBy: null,
            updatedAt: new Date(0),
            source: 'legacy_label',
          },
        ]
    return [...own, ...fallback].sort(
      (a, b) => localeRank(a.locale) - localeRank(b.locale),
    )
  })
}
