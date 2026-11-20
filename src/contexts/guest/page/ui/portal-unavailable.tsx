import {
  PORTAL_UNAVAILABLE_ENGLISH,
  type PortalUnavailableCopy,
} from './portal-unavailable-copy'
import {
  PORTAL_UNAVAILABLE_CSS,
  PORTAL_UNAVAILABLE_STYLE_HREF,
} from './portal-unavailable-styles'

/** Reloads the page: the same address, asked for again. */
function reloadPage() {
  window.location.reload()
}

/**
 * The single public posture for a Portal a guest cannot reach — a bad or
 * rotated token, an unpublished Portal, a suspended Property, a denied
 * capability, or a server that could not answer — all land here so none of them
 * is distinguishable from outside (routes/p/$token.tsx). Nothing about the
 * request but the visitor's own language can reach what it says: it takes no
 * reason, and "Try again" is on the page for every cause, so even pressing it
 * tells a guest nothing (a portal that is really gone shows the same page).
 *
 * It has no snapshot to take brand or language from, so it is the neutral page
 * of board G12, in the guest fonts: the self-hosted Ysabeau Office. It links
 * no stylesheet itself: the root chooses the guest set for a `/p/$token` match
 * with no loader data (`fontSetOfMatches`).
 *
 * The language is the one the visitor's browser asks for (`copy`), and, when
 * that is not English, the English words follow under a rule, so a guest who
 * cannot read the first can read the second. With no `copy` it is English alone.
 *
 * `main` is load-bearing, not decoration: without a landmark every word on
 * this page sits outside one, which is exactly what a screen-reader user
 * navigating by landmark finds nothing of.
 */
export function PortalUnavailable({
  copy = PORTAL_UNAVAILABLE_ENGLISH,
}: Readonly<{ copy?: PortalUnavailableCopy }>) {
  const english = PORTAL_UNAVAILABLE_ENGLISH
  return (
    <main className="portal-unavailable">
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
      <h1 lang={copy.locale} className="portal-unavailable__title">
        {copy.title}
      </h1>
      <p lang={copy.locale} className="portal-unavailable__body">
        {copy.body}
      </p>
      <button
        type="button"
        lang={copy.locale}
        className="portal-unavailable__retry"
        onClick={reloadPage}
      >
        {copy.retry}
      </button>
      {copy.locale !== english.locale && (
        <>
          <div aria-hidden="true" className="portal-unavailable__rule" />
          <p
            lang={english.locale}
            className="portal-unavailable__title portal-unavailable__title--secondary"
          >
            {english.title}
          </p>
          <p
            lang={english.locale}
            className="portal-unavailable__body portal-unavailable__body--secondary"
          >
            {english.body}
          </p>
        </>
      )}
    </main>
  )
}
