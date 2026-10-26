// The frame every editor section sits in: its name as the heading, one line on
// what it is, and the section body beneath. A section may put a control beside
// its heading (the Linktree's switch).

import type { ReactNode } from 'react'
import {
  PORTAL_EDITOR_SECTION_LABELS,
  type PortalEditorSection,
} from './portal-editor-sections'

type Props = Readonly<{
  section: PortalEditorSection
  description?: string
  /** A control that belongs to the section as a whole, drawn beside its heading. */
  actions?: ReactNode
  children: ReactNode
}>

export function PortalEditorSectionFrame({
  section,
  description,
  actions,
  children,
}: Props) {
  const headingId = `portal-editor-${section}-heading`
  return (
    <section aria-labelledby={headingId} className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="space-y-1">
          {/* Focusable by script only: a click on the preview that opens this
              section moves focus here (`revealEditorSection`). */}
          <h2
            id={headingId}
            tabIndex={-1}
            className="text-lg font-semibold tracking-tight outline-none"
          >
            {PORTAL_EDITOR_SECTION_LABELS[section]}
          </h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions === undefined ? null : <div className="pt-1">{actions}</div>}
      </header>
      {children}
    </section>
  )
}
