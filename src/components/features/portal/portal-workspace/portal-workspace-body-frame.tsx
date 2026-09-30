// The centred, padded column the interim tab bodies sit in. The shell's body is
// full width (the boards' three-column editor, review list beside its preview
// and History ledger with its Versions rail all run edge to edge), so the width
// limit lives with the content that still wants one. The panes that replace
// these bodies simply do not use this frame.

import type { ReactNode } from 'react'

export function PortalWorkspaceBodyFrame({
  children,
  wide = false,
}: Readonly<{
  children: ReactNode
  /** Room for a two-column body, as the Results tab draws it. */
  wide?: boolean
}>) {
  return (
    <div
      className={
        wide
          ? 'mx-auto w-full max-w-7xl px-4 py-5 md:px-6 md:py-8'
          : 'mx-auto w-full max-w-5xl px-4 py-5 md:px-6 md:py-8'
      }
    >
      {children}
    </div>
  )
}
