// Portal context — language coverage: for each language a Portal offers, which
// of the wording guests read is written and which is still missing.
//
// Pure: no I/O. The wording a Portal needs per language is its title, its
// description and one label per link. The Linktree title, a link's line and the
// hero description are optional (the language pack or nothing stands in for
// them), so they are never "missing".
//
// A title and a description are read the way publishing reads them: a language
// only has them when the Property has wording (a content row) for it, and the
// Portal's own override then takes the place of that wording. A Portal override
// with no Property wording behind it does not count, because publishing reads
// the Property's wording as the base.
//
// What a gap means is decided by publishing (`gapBlocksPublication`): a gap in
// the primary language blocks publishing (`blocksPublish`); a gap in any other
// language is a warning, because the builder copies the primary language's text
// into it and guests read that.
//
// The result names gaps by kind and link, never by wording: the only words it
// carries are the fallback-language label of a link with a gap, so a manager
// can tell which link it is.

import type { GuestLocale } from '#/shared/domain/guest-locale'
import { gapBlocksPublication } from './portal-publication-source'

export type PortalTextKind = 'title' | 'description' | 'link_label'

export type MissingPortalText = Readonly<{
  /** Stable within a language: `title`, `description` or `link:<linkId>`. */
  key: string
  kind: PortalTextKind
  linkId: string | null
  /** The link's name in the fallback language, for a missing link label. */
  linkLabel: string | null
  /** True for a gap in the primary language: publishing is refused while one is missing. */
  blocksPublish: boolean
}>

export type PortalLanguageCoverageRow = Readonly<{
  locale: GuestLocale
  /** The Portal's primary language: what stands in where another language has a gap. */
  isFallback: boolean
  total: number
  present: number
  missing: ReadonlyArray<MissingPortalText>
}>

export type PortalLanguageCoverage = Readonly<{
  portalId: string
  fallbackLocale: GuestLocale
  /** The fallback language first, then the others in the order they were added. */
  languages: ReadonlyArray<PortalLanguageCoverageRow>
  /** Gaps across every language. */
  missingTotal: number
}>

export type PortalLanguageCoverageInput = Readonly<{
  portalId: string
  primaryLocale: GuestLocale
  additionalLocales: readonly GuestLocale[]
  propertyContent: ReadonlyArray<
    Readonly<{ locale: GuestLocale; title: string; shortDescription: string }>
  >
  overrides: ReadonlyArray<
    Readonly<{
      locale: GuestLocale
      title: string | null
      shortDescription: string | null
    }>
  >
  /** The links in display order; `label` is the legacy label kept beside the texts. */
  links: ReadonlyArray<Readonly<{ id: string; label: string }>>
  linkTexts: ReadonlyArray<
    Readonly<{ linkId: string; locale: GuestLocale; label: string }>
  >
}>

const isWritten = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim().length > 0

function anyWritten(...candidates: ReadonlyArray<string | null | undefined>) {
  return candidates.some(isWritten)
}

function offeredLocales(input: PortalLanguageCoverageInput): GuestLocale[] {
  return [input.primaryLocale, ...input.additionalLocales].filter(
    (locale, index, all) => all.indexOf(locale) === index,
  )
}

function linkNameIn(
  input: PortalLanguageCoverageInput,
  link: Readonly<{ id: string; label: string }>,
): string {
  const text = input.linkTexts.find(
    (candidate) =>
      candidate.linkId === link.id && candidate.locale === input.primaryLocale,
  )
  return isWritten(text?.label) ? text.label : link.label
}

function missingTexts(
  input: PortalLanguageCoverageInput,
  locale: GuestLocale,
): { total: number; missing: MissingPortalText[] } {
  const content = input.propertyContent.find((item) => item.locale === locale)
  const override = input.overrides.find((item) => item.locale === locale)
  // No Property wording for the language: nothing is written, whatever the
  // overrides say (publishing drops the language).
  const hasPropertyWording = content !== undefined
  const wording: ReadonlyArray<Readonly<{ kind: PortalTextKind; written: boolean }>> = [
    {
      kind: 'title',
      written: hasPropertyWording && anyWritten(override?.title, content.title),
    },
    {
      kind: 'description',
      written:
        hasPropertyWording &&
        anyWritten(override?.shortDescription, content.shortDescription),
    },
  ]
  const blocksPublish = gapBlocksPublication(locale, input.primaryLocale)
  const missing: MissingPortalText[] = wording.flatMap(({ kind, written }) =>
    written ? [] : [{ key: kind, kind, linkId: null, linkLabel: null, blocksPublish }],
  )
  for (const link of input.links) {
    const written = input.linkTexts.some(
      (text) =>
        text.linkId === link.id && text.locale === locale && isWritten(text.label),
    )
    if (!written) {
      missing.push({
        key: `link:${link.id}`,
        kind: 'link_label',
        linkId: link.id,
        linkLabel: linkNameIn(input, link),
        blocksPublish,
      })
    }
  }
  return { total: wording.length + input.links.length, missing }
}

export function computePortalLanguageCoverage(
  input: PortalLanguageCoverageInput,
): PortalLanguageCoverage {
  const languages = offeredLocales(input).map((locale): PortalLanguageCoverageRow => {
    const { total, missing } = missingTexts(input, locale)
    return {
      locale,
      isFallback: locale === input.primaryLocale,
      total,
      present: total - missing.length,
      missing,
    }
  })
  return {
    portalId: input.portalId,
    fallbackLocale: input.primaryLocale,
    languages,
    missingTotal: languages.reduce((sum, row) => sum + row.missing.length, 0),
  }
}
