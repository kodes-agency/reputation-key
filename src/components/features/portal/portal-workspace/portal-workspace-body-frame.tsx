// The centred, padded column the interim tab bodies sit in. The shell's body is
// full width (the boards' three-column editor, review list beside its preview
// and History ledger with its Versions rail all run edge to edge), so the width
// limit lives with the content that still wants one. The panes that replace
// these bodies simply do not use this frame.

import type { ReactNode } from 'react'

export function PortalWorkspaceBodyFrame({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 md:px-6 md:py-8">{children}</div>
  )
}
