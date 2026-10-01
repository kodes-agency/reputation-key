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

type Ctx = Readonly<{ fallback: GuestLocale; forward: boolean; inV: string }>
type Kind = PublicationContentChange['kind']
type Handler<K extends Kind> = (
  change: Extract<PublicationContentChange, { kind: K }>,
  ctx: Ctx,
) => GuestEffect

const effect = (topic: string, ...text: Phrase): GuestEffect => ({ topic, text })
const again = (ctx: Ctx): string => (ctx.forward ? '' : ' again')
const backOr = (ctx: Ctx, forwardText: string, backText: string): string =>
  ctx.forward ? forwardText : backText

const HANDLERS: { readonly [K in Kind]: Handler<K> } = {
  language_removed: (c, x) =>
    effect(
      'Languages',
      nativeLanguage(c.locale),
      plain(` goes away; ${bareName(c.locale)} guests see ${bareName(x.fallback)}`),
    ),
  language_added: (c, x) =>
    effect(
      'Languages',
      nativeLanguage(c.locale),
      plain(backOr(x, ' is added', ' comes back')),
    ),
  primary_language_changed: (c, x) =>
    effect(
      'Languages',
      nativeLanguage(c.to),
      plain(backOr(x, ' becomes the main language', ' is the main language again')),
    ),
  link_removed: (c) =>
    effect('Linktree', ...tile(c.label, c.hasPhoto), plain(' goes away')),
  link_added: (c, x) =>
    effect(
      'Linktree',
      ...tile(c.label, c.hasPhoto),
      plain(backOr(x, ' is added', ' comes back')),
    ),
  link_renamed: (c, x) =>
    effect(
      'Linktree',
      quoted(c.from),
      plain(' is called '),
      quoted(c.to),
      plain(again(x)),
    ),
  link_address_changed: (c, x) =>
    effect(
      'Linktree',
      quoted(c.label),
      plain(
        backOr(
          x,
          ` goes to the address it has in ${x.inV}`,
          ' goes to its earlier address',
        ),
      ),
    ),
  link_photo_changed: (c, x) =>
    effect('Linktree', quoted(c.label), plain(tilePhotoEffect(c.how, x.forward, x.inV))),
  link_icon_changed: (c, x) =>
    effect(
      'Linktree',
      quoted(c.label),
      plain(backOr(x, ` shows the icon it has in ${x.inV}`, ' shows its earlier icon')),
    ),
  link_reworded: (c, x) =>
    effect(
      'Linktree',
      quoted(c.label),
      plain(
        backOr(
          x,
          ` reads as it does in ${x.inV} in ${bareName(c.locale)}`,
          ` reads as it did in ${bareName(c.locale)}`,
        ),
      ),
    ),
  links_reordered: (_c, x) =>
    effect(
      'Linktree',
      plain(
        backOr(x, `Tiles take ${x.inV}'s order`, 'Tiles return to their earlier order'),
      ),
    ),
  linktree_switched: (c) =>
    effect('Linktree', plain(`The section is turned ${c.enabled ? 'on' : 'off'}`)),
  wording_changed: (c, x) =>
    effect(
      'Wording',
      plain(
        `The ${bareName(c.locale)} ${WORDING_NAME[c.field]} reads as ${backOr(x, `it does in ${x.inV}`, 'it did')}`,
      ),
    ),
  heading_renamed: (c, x) =>
    effect(
      'Wording',
      plain('The heading '),
      quoted(c.from),
      plain(' is called '),
      quoted(c.to),
      plain(again(x)),
    ),
  look_changed: (c, x) =>
    effect(
      'Look',
      plain(`The ${lookNames(c.facets)} ${backOr(x, 'change', 'change back')}`),
    ),
  hero_photo_changed: (c, x) =>
    effect(
      'Look',
      plain(
        `The ${bareName(c.locale)} hero photo ${backOr(x, 'changes', 'changes back')}`,
      ),
    ),
  design_changed: (c, x) =>
    effect(
      'Page design',
      plain(
        c.to === 'immersive'
          ? backOr(x, 'Guests see the new design', 'Guests see the new design again')
          : 'Guests see the earlier design',
      ),
    ),
  feedback_threshold_changed: (c) =>
    effect(
      'Settings',
      plain(`The private feedback threshold goes from ${c.from} to ${c.to}`),
    ),
  review_address_changed: (_c, x) =>
    effect(
      'Settings',
      plain(
        backOr(
          x,
          'The Google review address changes',
          'The Google review address changes back',
        ),
      ),
    ),
}

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
  const ctx: Ctx = {
    fallback,
    forward: forwardTo !== undefined,
    inV: `version ${forwardTo}`,
  }
  const handler = HANDLERS[change.kind] as Handler<Kind>
  return handler(change as never, ctx)
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
