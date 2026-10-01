// Link tiles for the stories of boards G01, G09 and G10, as the guest page
// receives them: wording in the page's language, an icon key or a photo URL, and
// no destination. Stories only.

import type { ImmersiveLinktreeLink } from '../immersive-linktree'
import { STORY_HERO_PHOTO } from './story-hero-photo'

export const LINKTREE_LINKS_EN: readonly ImmersiveLinktreeLink[] = [
  {
    id: 'link-discover',
    iconKey: 'bed-double',
    imageUrl: STORY_HERO_PHOTO.url,
    label: 'Discover the resort',
    line: 'Rooms, pools, the sea',
    fallbackFrom: null,
  },
  {
    id: 'link-spa',
    iconKey: 'waves',
    imageUrl: null,
    label: 'Spa & treatments',
    line: 'Book a time',
    fallbackFrom: null,
  },
  {
    id: 'link-menu',
    iconKey: 'utensils',
    imageUrl: null,
    label: 'Olive Terrace menu',
    line: 'Lunch and dinner',
    fallbackFrom: null,
  },
  {
    id: 'link-directions',
    iconKey: 'map-pin',
    imageUrl: null,
    label: 'Getting here',
    line: 'Directions and parking',
    fallbackFrom: null,
  },
]

/**
 * Board G09: no photo has been uploaded yet, so every tile is an icon tile
 * (Discover takes an icon instead of its photo).
 */
export const LINKTREE_LINKS_NO_PHOTO: readonly ImmersiveLinktreeLink[] =
  LINKTREE_LINKS_EN.map((link) => ({ ...link, imageUrl: null }))

/** Board G10: long German words, and one label nobody has translated yet, shown in English. */
export const LINKTREE_LINKS_DE: readonly ImmersiveLinktreeLink[] = [
  {
    ...LINKTREE_LINKS_EN[0]!,
    label: 'Das Resort entdecken',
    line: 'Zimmer, Pools und Meer',
  },
  {
    ...LINKTREE_LINKS_EN[1]!,
    label: 'Spa & Anwendungen',
    line: 'Termin buchen',
  },
  { ...LINKTREE_LINKS_EN[2]!, fallbackFrom: 'en' },
  {
    ...LINKTREE_LINKS_EN[3]!,
    label: 'Anreise',
    line: 'Wegbeschreibung und Parken',
  },
]

/** Long unbroken German words, to check a tile grows instead of clipping them. */
export const LINKTREE_LINKS_LONG_WORDS: readonly ImmersiveLinktreeLink[] = [
  {
    ...LINKTREE_LINKS_EN[1]!,
    label: 'Wellnessbereichsöffnungszeiten',
    line: 'Donaudampfschifffahrtsgesellschaft',
  },
  {
    ...LINKTREE_LINKS_EN[2]!,
    label: 'Halbpensionsrestaurantkarte',
    line: 'Abendessenreservierungsmöglichkeiten',
  },
]
