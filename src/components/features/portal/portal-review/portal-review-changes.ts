// The change list of Review & publish as sentences. The review read says what
// part of the page changed, who changed it and the wording before and after;
// this decides the words. Pure: the page draws the pieces and the History
// tab's sentence builder is reused, so a change reads the same here as it does
// in the ledger once it is published.

import type {
  PortalPageEditKind,
  PortalPageEditSubject,
  PortalReviewChange,
} from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { describePageEditLine } from '../portal-history/portal-history-edit-line'
import { plain, strong, type Phrase } from '../portal-history/portal-history-phrase'

export type ReviewChangeGlyph = 'linktree' | 'text' | 'look' | 'settings' | 'page'

/** Where on the previewed page a change shows, so "Show" can bring it into view. */
export type ReviewPreviewPart = 'top' | 'welcome' | 'linktree'

export type ReviewChangeLine = Readonly<{
  /** Stable within one list, for React. */
  id: string
  glyph: ReviewChangeGlyph
  /** The part of the page, then what was done: "Linktree · renamed ‘Dinner menu’ to ‘Olive Terrace menu’". */
  headline: Phrase
  /** The wording before and after, or why the change matters; null when there is none. */
  detail: Phrase | null
  /** The person; null when the system made it or nobody is named. */
  actor: string | null
  /** When it was made; null for a reason the live page differs, which has no moment. */
  at: string | null
  /** The part of the preview "Show" scrolls to; null for a change with no place on the page. */
  part: ReviewPreviewPart | null
  /** The language the change is in; "Show" switches the preview to it. */
  locale: GuestLocale | null
}>

type Place = Readonly<{
  area: string
  glyph: ReviewChangeGlyph
  part: ReviewPreviewPart
}>

const LINKTREE: Place = { area: 'Linktree', glyph: 'linktree', part: 'linktree' }
const WELCOME: Place = { area: 'Welcome', glyph: 'text', part: 'welcome' }
const WORDING: Place = { area: 'Page wording', glyph: 'text', part: 'welcome' }
const LOOK: Place = { area: 'Look', glyph: 'look', part: 'top' }
const SETTINGS: Place = { area: 'Page settings', glyph: 'settings', part: 'top' }

/** The part of the page a ledger subject names. */
function placeOfSubject(subject: PortalPageEditSubject): Place {
  switch (subject.area) {
    case 'links':
    case 'category':
    case 'categories_reordered':
    case 'link':
    case 'links_reordered':
    case 'link_text':
    case 'link_section_switch':
    case 'link_section_title':
    case 'destination':
      return LINKTREE
    case 'welcome_text':
      return WELCOME
    case 'portal_text':
      return WORDING
    case 'look':
    case 'profile':
      return LOOK
    case 'display_name':
      return { area: 'Property name', glyph: 'settings', part: 'top' }
    case 'page_settings':
      return SETTINGS
  }
}

/** The part of the page a kind of change names, when the ledger has no row to say more. */
const PLACE_OF_KIND: Readonly<Record<PortalPageEditKind, Place>> = {
  portal_configuration: SETTINGS,
  portal_links: LINKTREE,
  property_brand_profile: LOOK,
  property_brand_content: WELCOME,
  portal_localized_override: WORDING,
  approved_destination: LINKTREE,
}

/** The language a subject's wording is in, when it has one. */
function localeOfSubject(subject: PortalPageEditSubject): GuestLocale | null {
  switch (subject.area) {
    case 'link_text':
    case 'link_section_title':
      return subject.locale
    case 'welcome_text':
    case 'portal_text':
      return subject.locale
    default:
      return null
  }
}

const actorName = (actor: Readonly<{ displayName: string | null }> | null) =>
  actor === null ? null : (actor.displayName ?? 'Someone')

/** "Linktree · " then the action, whose first word the sentence builder leaves lower case. */
const withArea = (area: string, action: Phrase): Phrase => [
  strong(area),
  plain(' · '),
  ...action,
]

const reason = (
  id: string,
  headline: string,
  detail: string,
  glyph: ReviewChangeGlyph = 'page',
): ReviewChangeLine => ({
  id,
  glyph,
  headline: [plain(headline)],
  detail: [plain(detail)],
  actor: null,
  at: null,
  part: null,
  locale: null,
})

/** One entry of the change list as a sentence; `index` keeps ids unique within the list. */
export function describeReviewChange(
  change: PortalReviewChange,
  index: number,
): ReviewChangeLine {
  const id = `${change.type}-${index}`
  switch (change.type) {
    case 'edit': {
      const place = placeOfSubject(change.subject)
      const line = describePageEditLine(null, {
        kind: 'page_edited',
        subject: change.subject,
        propertyWide: change.propertyWide,
        previousText: change.previousText,
        newText: change.newText,
        editCount: change.editCount,
      })
      return {
        id,
        glyph: place.glyph,
        headline: withArea(place.area, line.action),
        detail: line.detail,
        actor: actorName(change.actor),
        at: change.occurredAt,
        part: place.part,
        locale: localeOfSubject(change.subject),
      }
    }
    case 'unrecorded': {
      const place = PLACE_OF_KIND[change.kind]
      return {
        id,
        glyph: place.glyph,
        headline: withArea(place.area, [plain('changed')]),
        detail: null,
        actor: actorName(change.actor),
        at: change.occurredAt,
        part: place.part,
        locale: null,
      }
    }
    case 'earlier_design':
      return reason(
        id,
        'The live page is the earlier design',
        'Publishing moves guests to the new design.',
      )
    case 'google_destination_moved':
      return reason(
        id,
        'The Google address changed',
        'The live page still sends guests to the old address. Publishing updates it.',
      )
    case 'unlisted':
      return reason(
        id,
        'Other changes to the page',
        'The draft differs from the live page in ways this list cannot name.',
      )
    case 'no_visible_change':
      return reason(
        id,
        'Nothing guests would notice',
        'Changes were saved, but the page reads the same as the live version.',
      )
  }
}
