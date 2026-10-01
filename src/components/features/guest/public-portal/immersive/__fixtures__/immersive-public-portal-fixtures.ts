// A live Immersive Hub page as the route hands it over: the loader's data, a v2
// pack and actions that fail the test if a render ever calls one. Nothing here
// asserts; the tests do.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublicImmersiveLoaderData } from '#/contexts/guest/application/dto/public-portal.dto'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import type { GuestResponseActions } from '../guest-response-actions'
import {
  ImmersivePublicPortal,
  type ImmersivePublicPortalProps,
} from '../immersive-public-portal'
import { PACKS } from './immersive-response-fixtures'

export const TOKEN = 'tok-immersive'
export const NONCE = '11111111-1111-4111-8111-111111111111'
export const SERVED_AT = '2026-10-01T12:00:00.000Z'
const own = (value: string) => ({ value, fallbackFrom: null }) as const

export const [EN_PACK, BG_PACK] = PACKS as [(typeof PACKS)[0], (typeof PACKS)[1]]

export const IMMERSIVE: PublicImmersiveLoaderData = {
  timeZone: 'Europe/Sofia',
  brand: {
    displayName: 'Avela Resort',
    wordmark: 'AVELA',
    logo: null,
    hero: null,
    accentColour: '#EAD6A8',
    fieldColour: '#15110D',
  },
  content: {
    title: own('Pool and terrace'),
    shortDescription: own('Rate your visit.'),
    heroAlt: own(''),
    linktreeTitle: own('Around the resort'),
  },
  linktree: { enabled: true },
  links: [
    {
      id: '30000000-0000-4000-8000-000000000001',
      iconKey: 'utensils',
      imageUrl: null,
      label: 'Menu',
      line: 'Breakfast until 11',
      fallbackFrom: null,
    },
    {
      id: '30000000-0000-4000-8000-000000000002',
      iconKey: null,
      imageUrl: null,
      label: 'Spa',
      line: null,
      fallbackFrom: 'en',
    },
  ],
}

export const RATED: GuestResponseView = {
  status: 'submitted',
  rating: 2,
  hasPrivateFeedback: false,
  privateFeedbackEligible: true,
  submittedAt: '2026-10-01T11:55:00.000Z',
  correctedAt: null,
  correctionDeadline: '2026-10-01T12:55:00.000Z',
  correctionAvailable: true,
  responseWithdrawalDeadline: '2026-10-02T11:55:00.000Z',
  responseWithdrawalAvailable: true,
  feedbackSubmittedAt: null,
  feedbackWithdrawalDeadline: null,
  feedbackWithdrawalAvailable: false,
  feedbackWithdrawnAt: null,
  deletedAt: null,
}

const refuses = async (): Promise<never> => {
  throw new Error('a render must not call a server action')
}

export const INERT_ACTIONS: GuestResponseActions & ImmersivePublicPortalProps['actions'] =
  {
    submitResponse: refuses,
    correctResponse: refuses,
    startNewResponse: refuses,
    submitPrivateFeedback: refuses,
    selectGoogleReview: refuses,
    withdrawResponse: refuses,
    withdrawPrivateFeedback: refuses,
    selectSecondaryLink: refuses,
  }

export function immersivePortalProps(
  overrides: Partial<ImmersivePublicPortalProps> = {},
): ImmersivePublicPortalProps {
  return {
    token: TOKEN,
    pack: EN_PACK,
    immersive: IMMERSIVE,
    selectedLocale: 'en',
    availableLocales: ['en', 'bg'],
    googleReview: { status: 'available' },
    csrfNonce: NONCE,
    initialResponse: null,
    availability: 'available',
    servedAt: SERVED_AT,
    actions: INERT_ACTIONS,
    onPortalVisit: () => undefined,
    ...overrides,
  }
}

/** The page as a guest's first byte of HTML: styles dropped, so the markup reads plainly. */
export function renderImmersivePortal(
  overrides: Partial<ImmersivePublicPortalProps> = {},
): string {
  return renderToStaticMarkup(
    createElement(ImmersivePublicPortal, immersivePortalProps(overrides)),
  ).replace(/<style[\s\S]*?<\/style>/gu, '')
}
