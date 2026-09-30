// Shared fixtures for the guest page tests: the portal, the response values and
// states, and one renderer per path a guest page can be reached by. Nothing
// here asserts; the tests do.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { getGuestPortalCopy } from './guest-language-pack'
import { GuestPageView, type GuestPageViewProps } from './guest-page-view'
import {
  previewFormViewProps,
  type GuestPagePreviewState,
} from './guest-page-preview-state'
import type { PortalLocalization } from './portal-localization'
import { PortalSecondaryLinks } from './portal-secondary-links'
import {
  PublicPortalContent,
  type PublicPortalContentProps,
} from './public-portal-content'

export type Locale = 'en' | 'bg'
export const RATINGS = [1, 2, 3, 4, 5] as const
export const LOCALES: readonly Locale[] = ['en', 'bg']
export const LOCALIZATION: Readonly<Record<Locale, PortalLocalization>> = {
  en: {
    selectedLocale: 'en',
    primaryLocale: 'en',
    availableLocales: ['en', 'bg'],
    languagePackVersion: 'guest-ui-en-v1',
  },
  bg: {
    selectedLocale: 'bg',
    primaryLocale: 'en',
    availableLocales: ['en', 'bg'],
    languagePackVersion: 'guest-ui-bg-v1',
  },
}

export const portal = {
  name: 'The Harbor Hotel',
  description: 'Thank you for visiting.',
  organizationName: 'Harbor Hospitality',
  heroImageUrl: null,
  theme: null,
}
export const CATEGORIES = [{ id: 'c1', title: 'Useful links' }]
export const LINKS = [
  { id: 'l1', label: 'Hotel website', url: 'https://example.com/', categoryId: 'c1' },
]
const NONCE = '00000000-0000-4000-8000-000000000041'
const PRIVATE_FEEDBACK_THRESHOLD = 3

export function secondaryLinks(locale: Locale) {
  return createElement(PortalSecondaryLinks, {
    organizationName: portal.organizationName,
    categories: CATEGORIES,
    links: LINKS,
    locale,
    languagePackVersion: LOCALIZATION[locale].languagePackVersion,
  })
}

export function renderPage(
  locale: Locale,
  previewState: GuestPagePreviewState,
  overrides: Partial<GuestPageViewProps> = {},
): string {
  return renderToStaticMarkup(
    createElement(GuestPageView, {
      portal,
      localization: LOCALIZATION[locale],
      body: { kind: 'preview', previewState, secondaryLinks: secondaryLinks(locale) },
      ...overrides,
    }),
  )
}

const rejects = async () => {
  throw new Error('a server action must not run while rendering')
}

/** The live path: the public container, bound to a session that already holds `response`. */
export function renderLive(
  locale: Locale,
  response: GuestResponseView | null,
  googleStatus: 'available' | 'unavailable' = 'available',
): string {
  const props: PublicPortalContentProps = {
    token: 'tok',
    portal,
    categories: CATEGORIES,
    links: LINKS,
    localization: LOCALIZATION[locale],
    reviewGateway: {
      privateFeedbackThreshold: PRIVATE_FEEDBACK_THRESHOLD,
      googleReview: { status: googleStatus },
    },
    responseForm: {
      csrfNonce: NONCE,
      initialResponse: response,
      submitResponse: rejects,
      correctResponse: rejects,
      startNewResponse: rejects,
      submitPrivateFeedback: rejects,
      selectGoogleReview: rejects,
      withdrawResponse: rejects,
      withdrawPrivateFeedback: rejects,
    },
  }
  return renderToStaticMarkup(createElement(PublicPortalContent, props))
}

/** The correcting state, which a static render can only reach through the view prop. */
export function renderCorrecting(
  locale: Locale,
  response: GuestResponseView,
  googleReviewAvailable = true,
): string {
  const copy = getGuestPortalCopy(locale, LOCALIZATION[locale].languagePackVersion)
  const form = {
    ...previewFormViewProps(
      { kind: 'arrival' },
      { copy, secondaryLinks: secondaryLinks(locale) },
    ),
    response,
    googleReviewAvailable,
    correcting: true,
  }
  return renderToStaticMarkup(
    createElement(GuestPageView, {
      portal,
      localization: LOCALIZATION[locale],
      body: { kind: 'live', form },
    }),
  )
}

type ResponseShape = Readonly<{
  rating: number
  noteEligible: boolean
  noteSent?: boolean
  noteWithdrawn?: boolean
}>

/** Built here, independent of the preview module, so the live path stands on its own. */
export function submitted({
  rating,
  noteEligible,
  noteSent = false,
  noteWithdrawn = false,
}: ResponseShape): GuestResponseView {
  return {
    status: 'submitted',
    rating,
    hasPrivateFeedback: noteSent,
    privateFeedbackEligible: noteEligible && !noteSent,
    submittedAt: '2026-01-01T12:00:00.000Z',
    correctedAt: null,
    correctionDeadline: '2026-01-01T13:00:00.000Z',
    correctionAvailable: true,
    responseWithdrawalDeadline: '2026-01-02T12:00:00.000Z',
    responseWithdrawalAvailable: true,
    feedbackSubmittedAt: noteSent || noteWithdrawn ? '2026-01-01T12:05:00.000Z' : null,
    feedbackWithdrawalDeadline: noteSent ? '2026-01-02T12:00:00.000Z' : null,
    feedbackWithdrawalAvailable: noteSent,
    feedbackWithdrawnAt: noteWithdrawn ? '2026-01-01T12:10:00.000Z' : null,
    deletedAt: null,
  }
}

/** One guest response value or state, with the preview state that shows it (if any). */
export type Variant = Readonly<{
  label: string
  response: GuestResponseView
  preview: GuestPagePreviewState | null
}>

export const VARIANTS: readonly Variant[] = RATINGS.flatMap((rating) => [
  ...[true, false].map((noteEligible) => ({
    label: `rated ${rating}, note ${noteEligible ? 'offered' : 'not offered'}`,
    response: submitted({ rating, noteEligible }),
    preview: { kind: 'rated', rating, noteEligible } as const,
  })),
  {
    label: `note-writing ${rating}`,
    response: submitted({ rating, noteEligible: true }),
    preview: { kind: 'note-writing', rating } as const,
  },
  {
    label: `done ${rating}`,
    response: submitted({ rating, noteEligible: true, noteSent: true }),
    preview: { kind: 'done', rating } as const,
  },
  {
    label: `withdrawn note ${rating}`,
    response: submitted({ rating, noteEligible: true, noteWithdrawn: true }),
    preview: null,
  },
])
