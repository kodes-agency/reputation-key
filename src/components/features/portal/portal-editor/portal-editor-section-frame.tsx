// The frame every editor section sits in: its name as the heading, one line on
// what it is, and the section body beneath.

import type { ReactNode } from 'react'
import {
  PORTAL_EDITOR_SECTION_LABELS,
  type PortalEditorSection,
} from './portal-editor-sections'

type Props = Readonly<{
  section: PortalEditorSection
  description?: string
  children: ReactNode
}>

export function PortalEditorSectionFrame({ section, description, children }: Props) {
  const headingId = `portal-editor-${section}-heading`
  return (
    <section aria-labelledby={headingId} className="space-y-6">
      <header className="space-y-1">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight">
          {PORTAL_EDITOR_SECTION_LABELS[section]}
        </h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  )
}
