import type { ComponentProps } from 'react'
import { createLink } from '@tanstack/react-router'

// A navigation link whose "you are here" is the nav's, not the router's.
//
// TanStack's `Link` marks itself `aria-current="page"` and `data-status="active"`
// whenever the location is at or below its path, and sets them after every prop,
// so a caller cannot unset them. A nav draws its own active row from a test that
// fits its routes (the sidebar's section regex, the editor's `?section=`), so the
// two disagreed: the Dashboard link was announced as the current page on every
// Property page while one row was drawn active. NavLink keeps the router's address,
// preloading and click handling, drops its current/active marks, and applies the
// nav's answer once to `aria-current`. Style a row from `aria-[current=page]` and
// what is drawn and what is announced cannot drift.

type NavAnchorProps = ComponentProps<'a'> & {
  /** Whether this link is the page the person is on, as the nav decided it. */
  current: boolean
  /** Set by the router; ignored (see above). */
  'data-status'?: string
}

function NavAnchor({
  current,
  'aria-current': _routerCurrent,
  'data-status': _routerStatus,
  ...props
}: NavAnchorProps) {
  return <a {...props} aria-current={current ? 'page' : undefined} />
}

const RouterNavLink = createLink(NavAnchor)

/**
 * No router styling either: an active link gets the class `active` unless its
 * `activeProps` say otherwise, and a row styled from `aria-current` has no use for it.
 */
const NO_ROUTER_STYLE = {}

/** A router link (typed `to`, `params`, `search`) that is current only when told. */
const NavLink = ((props: ComponentProps<typeof RouterNavLink>) => (
  <RouterNavLink activeProps={NO_ROUTER_STYLE} {...props} />
)) as typeof RouterNavLink

export { NavLink }
