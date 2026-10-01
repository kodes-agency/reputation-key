// Shared fixtures for the Immersive Hub response tests: every v2 pack, one
// renderer for the response view, and handlers that fail the test if a render
// ever calls one. Nothing here asserts; the tests do.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GUEST_LOCALES, type GuestLocale } from '#/shared/domain/guest-locale'
import type { GuestPagePreviewState } from '../../guest-page-preview-state'
import type { GuestPortalCopyV2 } from '../../language-packs/guest-copy-v2'
import { loadGuestPortalCopyV2 } from '../../language-packs/load-guest-copy-v2'
import { immersiveResponseProps } from '../immersive-response-preview'
import {
  ImmersiveResponseView,
  type ImmersiveResponseViewProps,
} from '../immersive-response-view'

export const RATINGS = [1, 2, 3, 4, 5] as const
// Loaded the way a request loads them: a locale module is imported by the
// loader alone (`load-guest-copy-v2.test.ts` holds the codebase to that).
// Every language a guest can reach: the ADR 0044 proof must hold in each.
export const PACKS: readonly GuestPortalCopyV2[] = await Promise.all(
  GUEST_LOCALES.map((locale) => loadGuestPortalCopyV2(locale)),
)

/**
 * What each pack prints for a deadline in the Sofia zone, written out per
 * language so a template change shows up as a diff here: a deadline today and
 * tomorrow at `time`, and one on 4 October 2026 at 12:05.
 */
export const DEADLINE_WORDING: Readonly<
  Record<
    GuestLocale,
    Readonly<{
      today: (time: string) => string
      tomorrow: (time: string) => string
      laterDay: string
    }>
  >
> = {
  en: {
    today: (t) => `Until ${t} today, Sofia time`,
    tomorrow: (t) => `Until ${t} tomorrow, Sofia time`,
    laterDay: 'Until Oct 4, 2026, 12:05, Sofia time',
  },
  bg: {
    today: (t) => `До ${t} днес, местно време в София`,
    tomorrow: (t) => `До ${t} утре, местно време в София`,
    laterDay: 'До 4.10.2026 г., 12:05, местно време в София',
  },
  es: {
    today: (t) => `Hasta hoy a las ${t}, hora de Sofía`,
    tomorrow: (t) => `Hasta mañana a las ${t}, hora de Sofía`,
    laterDay: 'Hasta el 4 oct 2026, 12:05, hora de Sofía',
  },
  it: {
    today: (t) => `Fino alle ${t} di oggi, ora di Sofia`,
    tomorrow: (t) => `Fino alle ${t} di domani, ora di Sofia`,
    laterDay: 'Scadenza: 4 ott 2026, ore 12:05, ora di Sofia',
  },
  fr: {
    today: (t) => `Jusqu’à ${t} aujourd’hui, heure locale (Sofia)`,
    tomorrow: (t) => `Jusqu’à ${t} demain, heure locale (Sofia)`,
    laterDay: 'Jusqu’au 4 oct. 2026, 12:05, heure locale (Sofia)',
  },
  de: {
    today: (t) => `Bis heute, ${t} Uhr, Ortszeit Sofia`,
    tomorrow: (t) => `Bis morgen, ${t} Uhr, Ortszeit Sofia`,
    laterDay: 'Bis 04.10.2026, 12:05 Uhr, Ortszeit Sofia',
  },
}

export const DISPLAY_NAME = 'Avela Resort'

/** Renders the response view for a controlled state, as a preview or a story would. */
export function renderResponse(
  pack: GuestPortalCopyV2,
  state: GuestPagePreviewState,
  overrides: Partial<ImmersiveResponseViewProps> = {},
  threshold?: number,
): string {
  return renderToStaticMarkup(
    createElement(ImmersiveResponseView, {
      ...immersiveResponseProps(state, {
        pack,
        displayName: DISPLAY_NAME,
        privateFeedbackThreshold: threshold,
      }),
      ...overrides,
    }),
  )
}
