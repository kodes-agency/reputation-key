import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import {
  PORTAL_UNAVAILABLE_CSS,
  PORTAL_UNAVAILABLE_STYLE_HREF,
} from './portal-unavailable-styles'

// Fixed English and Bulgarian, as board G12 shows: the page has no snapshot and
// no portal, so no language can be chosen from the token without telling a guest
// something about it. A test holds these words to the guest copy packs'
// `unavailableTitle` and `unavailableBody` without bundling both packs here.
export const PORTAL_UNAVAILABLE_EN = {
  title: 'This page isn’t available right now.',
  body: 'Please check back later.',
} as const
export const PORTAL_UNAVAILABLE_BG = {
  title: 'Тази страница не е достъпна в момента.',
  body: 'Моля, опитайте отново по-късно.',
} as const

/**
 * The single public posture for a Portal a guest cannot reach — a bad or
 * rotated token, an unpublished Portal, a suspended Property, or a denied
 * capability all land here so none of them is distinguishable from outside
 * (routes/p/$token.tsx). It takes no props for that reason: nothing about the
 * request can reach what it says.
 *
 * It has no snapshot to take brand or language from, so it is the neutral page
 * of board G12, in the guest fonts: the self-hosted Ysabeau Office, loaded
 * here because the route's loader data (which picks the font set) is null.
 *
 * `main` is load-bearing, not decoration: without a landmark every word on
 * this page sits outside one, which is exactly what a screen-reader user
 * navigating by landmark finds nothing of.
 */
export function PortalUnavailable() {
  return (
    <main className="portal-unavailable">
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      <style href={PORTAL_UNAVAILABLE_STYLE_HREF} precedence="default">
        {PORTAL_UNAVAILABLE_CSS}
      </style>
      <span aria-hidden="true" className="portal-unavailable__icon">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
        </svg>
      </span>
      <h1 lang="en" className="portal-unavailable__title">
        {PORTAL_UNAVAILABLE_EN.title}
      </h1>
      <p lang="en" className="portal-unavailable__body">
        {PORTAL_UNAVAILABLE_EN.body}
      </p>
      <div aria-hidden="true" className="portal-unavailable__rule" />
      <p
        lang="bg"
        className="portal-unavailable__title portal-unavailable__title--secondary"
      >
        {PORTAL_UNAVAILABLE_BG.title}
      </p>
      <p
        lang="bg"
        className="portal-unavailable__body portal-unavailable__body--secondary"
      >
        {PORTAL_UNAVAILABLE_BG.body}
      </p>
    </main>
  )
}
