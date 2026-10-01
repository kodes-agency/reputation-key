// What a version added, and what making one live again would change back for
// guests, in the words a manager reads. Both come from the same list of
// changes (`diffPublicationContent`); they differ in the direction they are
// read: a summary reads a version against the one before it ("Added Deutsch"),
// a restore reads the version against the one guests see ("Deutsch comes
// back", "Deutsch goes away").

import type {
  PublicationContentChange,
  PublicationLookFacet,
  PublicationWordingField,
} from '#/contexts/portal/application/public-api'
import { GUEST_LOCALE_METADATA, type GuestLocale } from '#/shared/domain/guest-locale'
import {
  englishLanguage,
  joinPhrases,
  nativeLanguage,
  phraseText,
  plain,
  quoted,
  type Phrase,
} from './portal-history-phrase'

const WORDING_NAME: Readonly<Record<PublicationWordingField, string>> = {
  title: 'title',
  description: 'description',
  photo_description: 'photo description',
  linktree_title: 'Linktree title',
}

const LOOK_NAME: Readonly<Record<PublicationLookFacet, string>> = {
  colours: 'colours',
  name: 'name',
  wordmark: 'wordmark',
  logo: 'logo',
  photo: 'photo',
}

const MAX_LISTED_CHANGES = 4

const tile = (label: string, hasPhoto: boolean): Phrase =>
  hasPhoto ? [plain('the '), quoted(label), plain(' photo tile')] : [quoted(label)]

const lookNames = (facets: readonly PublicationLookFacet[]): string =>
  phraseText(joinPhrases(facets.map((facet) => [plain(LOOK_NAME[facet])])))

type Clause = Readonly<{ verb: 'added' | 'removed' | 'changed'; item: Phrase }>

/** One change as a clause of a summary: what was added, removed, or done. */
function clauseOf(change: PublicationContentChange): Clause {
  switch (change.kind) {
    case 'language_added':
      return { verb: 'added', item: [nativeLanguage(change.locale)] }
    case 'language_removed':
      return { verb: 'removed', item: [nativeLanguage(change.locale)] }
    case 'link_added':
      return { verb: 'added', item: tile(change.label, change.hasPhoto) }
    case 'link_removed':
      return { verb: 'removed', item: tile(change.label, change.hasPhoto) }
    case 'primary_language_changed':
      return {
        verb: 'changed',
        item: [plain('made '), nativeLanguage(change.to), plain(' the main language')],
      }
    case 'link_renamed':
      return {
        verb: 'changed',
        item: [plain('renamed '), quoted(change.from), plain(' to '), quoted(change.to)],
      }
    case 'link_address_changed':
      return {
        verb: 'changed',
        item: [plain('changed where '), quoted(change.label), plain(' goes')],
      }
    case 'link_reworded':
      return {
        verb: 'changed',
        item: [
          plain('reworded '),
          quoted(change.label),
          plain(` in ${englishLanguage(change.locale)}`),
        ],
      }
    case 'links_reordered':
      return { verb: 'changed', item: [plain('reordered the tiles')] }
    case 'linktree_switched':
      return {
        verb: 'changed',
        item: [plain(`turned the Linktree ${change.enabled ? 'on' : 'off'}`)],
      }
    case 'wording_changed':
      return {
        verb: 'changed',
        item: [
          plain(
            `reworded the ${englishLanguage(change.locale)} ${WORDING_NAME[change.field]}`,
          ),
        ],
      }
    case 'look_changed':
      return { verb: 'changed', item: [plain(`changed the ${lookNames(change.facets)}`)] }
    case 'design_changed':
      return {
        verb: 'changed',
        item: [
          plain(
            change.to === 'immersive'
              ? 'moved to the new guest page design'
              : 'went back to the earlier guest page design',
          ),
        ],
      }
    case 'feedback_threshold_changed':
      return {
        verb: 'changed',
        item: [plain(`changed the private feedback threshold to ${change.to}`)],
      }
    case 'review_address_changed':
      return { verb: 'changed', item: [plain('changed the Google review address')] }
  }
}

const VERB_ORDER = ['added', 'removed', 'changed'] as const

const capitalise = (phrase: Phrase): Phrase => {
  const [first, ...rest] = phrase
  if (!first || first.lang !== undefined) return phrase
  return [
    { ...first, text: first.text.charAt(0).toUpperCase() + first.text.slice(1) },
    ...rest,
  ]
}

/**
 * What a version did, in one line: "added Deutsch and ‘Getting here’; removed
 * ‘Dinner’". At most four items are named; the rest are counted. Empty changes
 * say so plainly (a publication can carry only what guests never see).
 */
export function summarizeChanges(
  changes: readonly PublicationContentChange[],
  options: Readonly<{ capitalised?: boolean }> = {},
): Phrase {
  if (changes.length === 0) {
    const none: Phrase = [plain('nothing changed on the guest page')]
    return options.capitalised ? capitalise(none) : none
  }
  const clauses = changes.map(clauseOf)
  const listed = clauses.slice(0, MAX_LISTED_CHANGES)
  const parts: Phrase[] = VERB_ORDER.flatMap((verb) => {
    const items = listed.filter((clause) => clause.verb === verb).map((c) => c.item)
    if (items.length === 0) return []
    const lead = verb === 'changed' ? [] : [plain(`${verb} `)]
    return [[...lead, ...joinPhrases(items)]]
  })
  const rest = clauses.length - listed.length
  const summary: Phrase = parts.flatMap((part, index): Phrase =>
    index === 0 ? part : [plain('; '), ...part],
  )
  const withRest: Phrase =
    rest > 0
      ? [...summary, plain(` and ${rest} more ${rest === 1 ? 'change' : 'changes'}`)]
      : summary
  return options.capitalised ? capitalise(withRest) : withRest
}

/** "First version · English and Български", or what the version added. */
export function summarizeVersion(
  version: Readonly<{
    isFirst: boolean
    languages: readonly GuestLocale[]
    changes: readonly PublicationContentChange[]
  }>,
  options: Readonly<{ capitalised?: boolean }> = {},
): Phrase {
  if (!version.isFirst) return summarizeChanges(version.changes, options)
  const names = joinPhrases(version.languages.map((locale) => [nativeLanguage(locale)]))
  return [plain(options.capitalised ? 'First version · ' : 'first version · '), ...names]
}

// ── what making a version live again changes back ─────────────────────────

export type GuestEffect = Readonly<{ topic: string; text: Phrase }>

const bareName = (locale: GuestLocale): string =>
  GUEST_LOCALE_METADATA[locale].englishName

/**
 * One change from the live version to the chosen one, as it lands for guests.
 * `fallback` is the chosen version's main language: it is what a language that
 * goes away falls back to.
 */
export function describeGuestEffect(
  change: PublicationContentChange,
  fallback: GuestLocale,
): GuestEffect {
  switch (change.kind) {
    case 'language_removed':
      return {
        topic: 'Languages',
        text: [
          nativeLanguage(change.locale),
          plain(
            ` goes away; ${bareName(change.locale)} guests see ${bareName(fallback)}`,
          ),
        ],
      }
    case 'language_added':
      return {
        topic: 'Languages',
        text: [nativeLanguage(change.locale), plain(' comes back')],
      }
    case 'primary_language_changed':
      return {
        topic: 'Languages',
        text: [nativeLanguage(change.to), plain(' is the main language again')],
      }
    case 'link_removed':
      return {
        topic: 'Linktree',
        text: [...tile(change.label, change.hasPhoto), plain(' goes away')],
      }
    case 'link_added':
      return {
        topic: 'Linktree',
        text: [...tile(change.label, change.hasPhoto), plain(' comes back')],
      }
    case 'link_renamed':
      return {
        topic: 'Linktree',
        text: [
          quoted(change.from),
          plain(' is called '),
          quoted(change.to),
          plain(' again'),
        ],
      }
    case 'link_address_changed':
      return {
        topic: 'Linktree',
        text: [quoted(change.label), plain(' goes to its earlier address')],
      }
    case 'link_reworded':
      return {
        topic: 'Linktree',
        text: [
          quoted(change.label),
          plain(` reads as it did in ${bareName(change.locale)}`),
        ],
      }
    case 'links_reordered':
      return { topic: 'Linktree', text: [plain('Tiles return to their earlier order')] }
    case 'linktree_switched':
      return {
        topic: 'Linktree',
        text: [plain(`The section is turned ${change.enabled ? 'on' : 'off'}`)],
      }
    case 'wording_changed':
      return {
        topic: 'Wording',
        text: [
          plain(
            `The ${bareName(change.locale)} ${WORDING_NAME[change.field]} reads as it did`,
          ),
        ],
      }
    case 'look_changed':
      return {
        topic: 'Look',
        text: [plain(`The ${lookNames(change.facets)} change back`)],
      }
    case 'design_changed':
      return {
        topic: 'Page design',
        text: [
          plain(
            change.to === 'immersive'
              ? 'Guests see the new design again'
              : 'Guests see the earlier design',
          ),
        ],
      }
    case 'feedback_threshold_changed':
      return {
        topic: 'Settings',
        text: [
          plain(
            `The private feedback threshold goes from ${change.from} to ${change.to}`,
          ),
        ],
      }
    case 'review_address_changed':
      return {
        topic: 'Settings',
        text: [plain('The Google review address changes back')],
      }
  }
}
