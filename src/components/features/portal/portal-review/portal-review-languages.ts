// A language row of Review & publish: the language by its own name, how much of
// its wording is written, and any drafts nobody has checked. The wording of the
// coverage line is the Languages section's own, so the two pages agree.

import type { ReviewLanguageRow } from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  describeCoverage,
  languageDisplayName,
  type CoverageDescription,
} from '../portal-languages/portal-languages-rules'

export type ReviewLanguageLine = Readonly<{
  locale: GuestLocale
  chip: string
  native: string
  /** The English name beside the language's own; null when the two are the same. */
  english: string | null
  /** "Fallback" for the language that stands in where another has a gap. */
  tag: string | null
  coverage: CoverageDescription
  /** "2 AI drafts not checked"; null when every text is written by a person. */
  aiDrafts: string | null
}>

export function describeReviewLanguage(row: ReviewLanguageRow): ReviewLanguageLine {
  const name = languageDisplayName(row.locale)
  return {
    locale: row.locale,
    chip: name.chip,
    native: name.native,
    english: name.english === name.native ? null : name.english,
    tag: row.isFallback ? 'Fallback' : null,
    coverage: describeCoverage(row),
    aiDrafts:
      row.aiDraftCount === 0
        ? null
        : `${row.aiDraftCount} AI ${row.aiDraftCount === 1 ? 'draft' : 'drafts'} not checked`,
  }
}
