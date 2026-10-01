// Whether a pathname is the portal workspace: one portal's editor
// (`/properties/:propertyId/portals/:portalId`) or its review page (`…/review`).
//
// The workspace is full-bleed, like the Inbox: the authenticated layout drops
// its page padding and collapses the sidebar to the icon rail, and the property
// layout gives it the whole height, so the workspace scrolls its own panes.
// Both layout routes ask this one question so they cannot disagree. The portals
// list, the New portal form and the group pages stay in the padded page shell.

/** `new` and `look` are static siblings of `$portalId`; the router picks them first. */
const WORKSPACE_PATH =
  /^\/properties\/[^/]+\/portals\/(?!(?:new|look)(?:\/|$))[^/]+(?:\/review)?\/?$/u

export function isWorkspaceRoute(pathname: string | undefined): boolean {
  return pathname !== undefined && WORKSPACE_PATH.test(pathname)
}

const REVIEW_PATH = /^\/properties\/[^/]+\/portals\/[^/]+\/review\/?$/u

/** The review page, as opposed to the editor: the header swaps its tabs for a way back. */
export function isWorkspaceReviewRoute(pathname: string | undefined): boolean {
  return pathname !== undefined && REVIEW_PATH.test(pathname)
}
