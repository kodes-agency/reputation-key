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
import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  englishLanguage,
  joinPhrases,
  nativeLanguage,
  phraseText,
  plain,
  quoted,
  type Phrase,
} from './portal-history-phrase'

export const WORDING_NAME: Readonly<Record<PublicationWordingField, string>> = {
  title: 'title',
  description: 'description',
  link_preview: 'link preview text',
  photo_description: 'photo description',
  linktree_title: 'Linktree title',
}

const LOOK_NAME: Readonly<Record<PublicationLookFacet, string>> = {
  colours: 'colours',
  name: 'name',
  wordmark: 'wordmark',
  logo: 'logo',
  photo: 'photo',
  photo_focus: 'photo position',
}

const MAX_LISTED_CHANGES = 4

export const tile = (label: string, hasPhoto: boolean): Phrase =>
  hasPhoto ? [plain('the '), quoted(label), plain(' photo tile')] : [quoted(label)]

export const lookNames = (facets: readonly PublicationLookFacet[]): string =>
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
    case 'link_photo_changed':
      return {
        verb: 'changed',
        item: {
          added: [plain('added a photo to '), quoted(change.label)],
          removed: [plain('took the photo off '), quoted(change.label)],
          replaced: [plain('replaced the photo on '), quoted(change.label)],
        }[change.how],
      }
    case 'link_icon_changed':
      return {
        verb: 'changed',
        item: [plain('changed the icon on '), quoted(change.label)],
      }
    case 'links_reordered':
      return { verb: 'changed', item: [plain('reordered the tiles')] }
    case 'heading_renamed':
      return {
        verb: 'changed',
        item: [
          plain('renamed the heading '),
          quoted(change.from),
          plain(' to '),
          quoted(change.to),
        ],
      }
    case 'hero_photo_changed':
      return {
        verb: 'changed',
        item: [plain(`changed the ${englishLanguage(change.locale)} hero photo`)],
      }
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
