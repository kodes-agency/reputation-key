// Whether a pathname is a full-bleed surface: one that owns its whole viewport
// below the top bar and scrolls its own panes, instead of sitting in the padded
// page shell. The Inbox, a Property's Reviews and the portal workspace are the
// three.
//
// Two layout routes ask this one question: the authenticated shell (drops the
// `<main>` gutter and holds the sidebar at the icon rail) and the Property
// layout (gives the child the full height). Adding a full-bleed surface means
// editing this file, and nothing else decides. A full-bleed surface that wants
// the page gutter back for a padded body wraps it in `FullBleedFrame`.

import { isWorkspaceRoute } from '#/components/features/portal/portal-workspace/portal-workspace-route'

const INBOX_PATH = /^\/inbox(?:\/|$)/u
const PROPERTY_REVIEWS_PATH = /^\/properties\/[^/]+\/reviews(?:\/|$)/u

export function isFullBleedRoute(pathname: string | undefined): boolean {
  if (pathname === undefined) return false
  return (
    INBOX_PATH.test(pathname) ||
    PROPERTY_REVIEWS_PATH.test(pathname) ||
    isWorkspaceRoute(pathname)
  )
}
