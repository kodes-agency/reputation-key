// What making a version live again changes for guests, one line per change, in
// the words a manager reads. The changes come from the same comparison as a
// version's summary (`diffPublicationContent`), read from the version guests see
// now to the chosen one: when the chosen version is earlier a change "comes
// back", when it is later the chosen version brings it.

import type { PublicationContentChange } from '#/contexts/portal/application/public-api'
import { GUEST_LOCALE_METADATA, type GuestLocale } from '#/shared/domain/guest-locale'
import { nativeLanguage, plain, quoted, type Phrase } from './portal-history-phrase'
import { WORDING_NAME, lookNames, tile } from './portal-version-summary'

export type GuestEffect = Readonly<{ topic: string; text: Phrase }>

const bareName = (locale: GuestLocale): string =>
  GUEST_LOCALE_METADATA[locale].englishName

/**
 * One change from the live version to the chosen one, as it lands for guests.
 * `fallback` is the chosen version's main language: it is what a language that
 * goes away falls back to. The chosen version may be earlier than the live one
 * (the change "comes back") or later (`forwardTo` is its number: the change is
 * "taken" from it), and the wording follows the direction.
 */
export function describeGuestEffect(
  change: PublicationContentChange,
  fallback: GuestLocale,
  forwardTo?: number,
): GuestEffect {
  const forward = forwardTo !== undefined
  const inV = `version ${forwardTo}`
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
        text: [
          nativeLanguage(change.locale),
          plain(forward ? ' is added' : ' comes back'),
        ],
      }
    case 'primary_language_changed':
      return {
        topic: 'Languages',
        text: [
          nativeLanguage(change.to),
          plain(forward ? ' becomes the main language' : ' is the main language again'),
        ],
      }
    case 'link_removed':
      return {
        topic: 'Linktree',
        text: [...tile(change.label, change.hasPhoto), plain(' goes away')],
      }
    case 'link_added':
      return {
        topic: 'Linktree',
        text: [
          ...tile(change.label, change.hasPhoto),
          plain(forward ? ' is added' : ' comes back'),
        ],
      }
    case 'link_renamed':
      return {
        topic: 'Linktree',
        text: [
          quoted(change.from),
          plain(' is called '),
          quoted(change.to),
          plain(forward ? '' : ' again'),
        ],
      }
    case 'link_address_changed':
      return {
        topic: 'Linktree',
        text: [
          quoted(change.label),
          plain(
            forward
              ? ` goes to the address it has in ${inV}`
              : ' goes to its earlier address',
          ),
        ],
      }
    case 'link_photo_changed':
      return {
        topic: 'Linktree',
        text: [quoted(change.label), plain(tilePhotoEffect(change.how, forward, inV))],
      }
    case 'link_icon_changed':
      return {
        topic: 'Linktree',
        text: [
          quoted(change.label),
          plain(forward ? ` shows the icon it has in ${inV}` : ' shows its earlier icon'),
        ],
      }
    case 'link_reworded':
      return {
        topic: 'Linktree',
        text: [
          quoted(change.label),
          plain(
            forward
              ? ` reads as it does in ${inV} in ${bareName(change.locale)}`
              : ` reads as it did in ${bareName(change.locale)}`,
          ),
        ],
      }
    case 'links_reordered':
      return {
        topic: 'Linktree',
        text: [
          plain(
            forward ? `Tiles take ${inV}'s order` : 'Tiles return to their earlier order',
          ),
        ],
      }
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
            `The ${bareName(change.locale)} ${WORDING_NAME[change.field]} reads as ${
              forward ? `it does in ${inV}` : 'it did'
            }`,
          ),
        ],
      }
    case 'heading_renamed':
      return {
        topic: 'Wording',
        text: [
          plain('The heading '),
          quoted(change.from),
          plain(' is called '),
          quoted(change.to),
          plain(forward ? '' : ' again'),
        ],
      }
    case 'look_changed':
      return {
        topic: 'Look',
        text: [
          plain(`The ${lookNames(change.facets)} ${forward ? 'change' : 'change back'}`),
        ],
      }
    case 'hero_photo_changed':
      return {
        topic: 'Look',
        text: [
          plain(
            `The ${bareName(change.locale)} hero photo ${forward ? 'changes' : 'changes back'}`,
          ),
        ],
      }
    case 'design_changed':
      return {
        topic: 'Page design',
        text: [
          plain(
            change.to === 'immersive'
              ? forward
                ? 'Guests see the new design'
                : 'Guests see the new design again'
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
        text: [
          plain(
            forward
              ? 'The Google review address changes'
              : 'The Google review address changes back',
          ),
        ],
      }
  }
}

const tilePhotoEffect = (
  how: 'added' | 'removed' | 'replaced',
  forward: boolean,
  inV: string,
): string => {
  if (how === 'removed') return ' loses its photo'
  if (!forward)
    return how === 'added' ? ' gets its photo back' : ' shows its earlier photo'
  return how === 'added'
    ? ` gets the photo it has in ${inV}`
    : ` shows the photo it has in ${inV}`
}
