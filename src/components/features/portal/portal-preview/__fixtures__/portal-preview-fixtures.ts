// Story and test data for the live preview: a draft in English and Bulgarian
// with one tile still waiting for approval, a live version, and readers that
// answer like the server function (the draft, the live version, a version with
// the earlier design, or a failure).

import type {
  PortalPreview,
  PortalPreviewExperience,
  PortalPreviewOutcome,
  PortalPreviewSource,
} from '#/contexts/portal/application/public-api'
import type { PortalPreviewReader } from '../portal-preview-pane'

const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#35402f"/><stop offset="0.6" stop-color="#8a6a3c"/><stop offset="1" stop-color="#d7a86a"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#g)"/></svg>`
export const PREVIEW_STORY_PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(PHOTO_SVG)}`

const own = (value: string) => ({ value, fallbackFrom: null }) as const

const BRAND = {
  displayName: 'Avela Resort',
  wordmark: 'AVELA',
  logo: null,
  hero: {
    url: PREVIEW_STORY_PHOTO,
    width: 1600,
    height: 1000,
    focalX: 0.5,
    focalY: 0.42,
  },
  accentColour: '#EAD6A8',
  fieldColour: '#15110D',
} as const

const ENGLISH: PortalPreviewExperience = {
  timeZone: 'Europe/Sofia',
  brand: BRAND,
  content: {
    title: own('Pool & Terrace'),
    shortDescription: own('Rate your visit to Avela Resort.'),
    heroAlt: own('The colonnade pool at dusk'),
    linktreeTitle: own('Around the resort'),
  },
  linktree: { enabled: true },
  links: [
    {
      id: 'l-1',
      state: 'ready',
      iconKey: 'book-open',
      imageUrl: null,
      label: 'Discover the resort',
      line: 'Rooms, pools, the sea',
      fallbackFrom: null,
    },
    {
      id: 'l-2',
      state: 'ready',
      iconKey: 'waves',
      imageUrl: null,
      label: 'Spa & treatments',
      line: 'Book a time',
      fallbackFrom: null,
    },
    {
      id: 'l-3',
      state: 'awaiting_approval',
      iconKey: 'utensils',
      imageUrl: null,
      label: 'Olive Terrace menu',
      line: 'Lunch and dinner',
      fallbackFrom: null,
    },
    {
      id: 'l-4',
      state: 'ready',
      iconKey: 'map-pin',
      imageUrl: null,
      label: 'Getting here',
      line: 'Directions and parking',
      fallbackFrom: null,
    },
  ],
}

const BULGARIAN: PortalPreviewExperience = {
  ...ENGLISH,
  content: {
    title: own('Басейн и тераса'),
    shortDescription: own('Оценете посещението си в Авела.'),
    heroAlt: { value: 'The colonnade pool at dusk', fallbackFrom: 'en' },
    linktreeTitle: own('Около курорта'),
  },
  links: ENGLISH.links.map((link, index) =>
    index === 1
      ? {
          ...link,
          label: 'Spa & treatments',
          line: 'Book a time',
          fallbackFrom: 'en' as const,
        }
      : { ...link, label: `${link.label} (БГ)` },
  ),
}

export const PREVIEW_DRAFT: PortalPreview = {
  portalId: 'p-1',
  source: 'draft',
  version: null,
  primaryLocale: 'en',
  locales: ['en', 'bg'],
  privateFeedbackThreshold: 3,
  experiences: { en: ENGLISH, bg: BULGARIAN },
}

export const PREVIEW_LIVE: PortalPreview = {
  ...PREVIEW_DRAFT,
  source: 'live',
  version: 5,
  experiences: {
    en: { ...ENGLISH, links: ENGLISH.links.filter((link) => link.state === 'ready') },
    bg: { ...BULGARIAN, links: BULGARIAN.links.filter((link) => link.state === 'ready') },
  },
}

export const PREVIEW_DRAFT_ONE_LANGUAGE: PortalPreview = {
  ...PREVIEW_DRAFT,
  locales: ['en'],
  experiences: { en: ENGLISH },
}

export const PREVIEW_DRAFT_NO_PHOTO: PortalPreview = {
  ...PREVIEW_DRAFT,
  experiences: {
    en: { ...ENGLISH, brand: { ...BRAND, hero: null } },
    bg: { ...BULGARIAN, brand: { ...BRAND, hero: null } },
  },
}

export type PreviewReaderOptions = Readonly<{
  draft?: PortalPreview
  live?: PortalPreviewOutcome
  fail?: boolean
}>

/** A reader that answers like the server function, and records what was asked. */
export function previewReader(
  options: PreviewReaderOptions = {},
  asked: PortalPreviewSource[] = [],
): PortalPreviewReader {
  return async ({ data }) => {
    asked.push(data.source)
    if (options.fail) throw new Error('preview unavailable')
    if (data.source === 'draft') {
      return { status: 'ready', preview: options.draft ?? PREVIEW_DRAFT }
    }
    return options.live ?? { status: 'ready', preview: PREVIEW_LIVE }
  }
}
