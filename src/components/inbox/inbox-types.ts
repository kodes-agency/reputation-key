import type { InboxCurrentUser } from './inbox-case-toolbar-props'

export type InboxCtx = Readonly<{
  /**
   * The route context's viewer (`routes/_authenticated.tsx:165-168`). Typed as
   * the pane's `InboxCurrentUser` rather than `{ id }` since plan v2.1 row 4:
   * the owner control draws the viewer's own initials from `name`, and both
   * routes already hand this page the whole `ctx`, so nothing new is fetched.
   */
  user?: InboxCurrentUser
  activeOrganization: {
    id: string
  } | null
}>
