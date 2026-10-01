// The sentence for a page edit. The page-edit ledger names the part of the page
// (`PortalPageEditSubject`) and keeps wording only where wording changed, so a
// line quotes the guests' own words when it has them and never invents any.

import type {
  PortalHistoryDetail,
  PortalPageEditSubject,
} from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { HistoryLine } from './portal-history-line-types'
import {
  englishLanguage,
  plain,
  quoted,
  strong,
  type Phrase,
} from './portal-history-phrase'

type PageEditDetail = Extract<PortalHistoryDetail, { kind: 'page_edited' }>

const withLocale = (locale: GuestLocale | null): string =>
  locale === null ? '' : `${englishLanguage(locale)} `

/** The wording before and after, as ‘before’ → ‘after’; null when the ledger kept none. */
function wordingChange(
  detail: PageEditDetail,
  locale: GuestLocale | null,
): Phrase | null {
  const lang = locale ?? undefined
  const { previousText, newText } = detail
  if (previousText !== null && newText !== null) {
    return [quoted(previousText, lang), plain(' → '), quoted(newText, lang)]
  }
  if (newText !== null) return [quoted(newText, lang)]
  return null
}

const SETTING_ACTION: Readonly<Record<string, string>> = {
  name: 'renamed the portal',
  slug: 'changed the portal’s address',
  description: 'reworded the description',
  hero_image: 'changed the hero photo',
  theme: 'changed the colours',
  feedback_threshold: 'changed the private feedback threshold',
  primary_language: 'changed the main language',
  additional_languages: 'changed the languages',
}

const LOOK_ACTION: Readonly<Record<string, string>> = {
  accent: 'changed the accent colour',
  field: 'changed the background colour',
  text: 'changed the text colour',
  wordmark: 'changed the wordmark',
  images: 'changed the logo or photo',
}

/** The sentence's action for a part of the page, and the language its wording is in. */
function describeEditSubject(
  subject: PortalPageEditSubject,
  detail: PageEditDetail,
): Readonly<{ action: Phrase; locale: GuestLocale | null; showWording: boolean }> {
  const out = (
    action: Phrase,
    locale: GuestLocale | null = null,
    showWording = true,
  ) => ({
    action,
    locale,
    showWording,
  })
  switch (subject.area) {
    case 'page_settings':
      return out([
        plain(
          subject.field === null
            ? 'changed the page settings'
            : (SETTING_ACTION[subject.field] ?? 'changed the page settings'),
        ),
      ])
    case 'welcome_text':
      return out(
        [plain('reworded '), strong(`the ${withLocale(subject.locale)}welcome line`)],
        subject.locale,
      )
    case 'portal_text':
      return out(
        [
          plain('reworded '),
          strong(`the ${withLocale(subject.locale)}wording of the page`),
        ],
        subject.locale,
      )
    case 'link': {
      const { previousText, newText } = detail
      if (subject.change === 'created') {
        return out(
          newText === null
            ? [plain('added a tile')]
            : [plain('added '), strong(`‘${newText}’`)],
          null,
          false,
        )
      }
      if (subject.change === 'deleted') {
        return out(
          previousText === null
            ? [plain('removed a tile')]
            : [plain('removed '), strong(`‘${previousText}’`)],
          null,
          false,
        )
      }
      if (previousText !== null && newText !== null && previousText !== newText) {
        return out(
          [
            plain('renamed '),
            strong(`‘${previousText}’`),
            plain(' to '),
            strong(`‘${newText}’`),
          ],
          null,
          false,
        )
      }
      return out(
        [plain('changed '), strong(newText === null ? 'a tile' : `‘${newText}’`)],
        null,
        false,
      )
    }
    case 'link_text':
      return out(
        [plain('reworded '), strong(`a tile in ${englishLanguage(subject.locale)}`)],
        subject.locale,
      )
    case 'link_section_title':
      return out(
        [
          plain('reworded '),
          strong(`the ${englishLanguage(subject.locale)} Linktree title`),
        ],
        subject.locale,
      )
    case 'link_section_switch':
      return out([plain('changed whether the Linktree shows')], null, false)
    case 'links_reordered':
    case 'categories_reordered':
      return out([plain('reordered '), strong('the tiles')], null, false)
    case 'category':
      return out(
        [
          plain(
            `${subject.change === 'created' ? 'added' : subject.change === 'renamed' ? 'renamed' : 'removed'} a group of links`,
          ),
        ],
        null,
        true,
      )
    case 'links':
      return out([plain('changed '), strong('the links')], null, false)
    case 'display_name':
      return out([plain('renamed '), strong('the property’s public name')])
    case 'look':
      return out(
        [
          plain(
            subject.facet === null
              ? 'changed the look'
              : (LOOK_ACTION[subject.facet] ?? 'changed the look'),
          ),
        ],
        null,
        false,
      )
    case 'profile':
      return out([plain('changed the property’s look')], null, false)
    case 'destination':
      return out([plain('changed an approved destination')], null, false)
  }
}

export function describePageEditLine(
  actor: string | null,
  detail: PageEditDetail,
): HistoryLine {
  const { action, locale, showWording } = describeEditSubject(detail.subject, detail)
  const pieces: Phrase[] = []
  const wording = showWording ? wordingChange(detail, locale) : null
  if (wording) pieces.push(wording)
  if (detail.propertyWide) pieces.push([plain('for every portal of this property')])
  if (detail.editCount > 1) pieces.push([plain(`${detail.editCount} saves`)])
  return {
    glyph: 'edit',
    actor: actor ?? 'The system',
    action,
    detail: pieces.length === 0 ? null : joinDetail(pieces),
  }
}

/** Detail pieces side by side with a dot between them. */
const joinDetail = (pieces: ReadonlyArray<Phrase>): Phrase =>
  pieces.flatMap((piece, index): Phrase =>
    index === 0 ? piece : [plain(' · '), ...piece],
  )
