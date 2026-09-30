// The workspace frame: a header, an optional tab strip, and one scrolling body.
//
// The authenticated layout gives this route the whole viewport (see
// `isWorkspaceRoute`), so the frame owns the height and the body scrolls on its
// own — the header and tabs stay put while a long editor scrolls beneath them.
// `PortalWorkspaceHeader` and `PortalWorkspaceTabs` are passed in rather than
// built here, so the shell stays a frame and each of them stays testable alone.

import type { ReactNode } from 'react'

type Props = Readonly<{
  header: ReactNode
  /** Absent in review mode, which is a focused step rather than a tab. */
  tabs?: ReactNode
  children: ReactNode
}>

export function PortalWorkspaceShell({ header, tabs, children }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {header}
      {tabs}
      {/* Full width: a tab body decides its own frame (see PortalWorkspaceBodyFrame). */}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
