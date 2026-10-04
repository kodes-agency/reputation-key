// The editor's section list: every part of the portal page, in the order guests
// meet it, then what only managers see. Each entry is a link to the same route
// with a different `?section=`, so the browser's Back button steps between
// sections and each has an address that can be shared. That makes this a
// navigation landmark with `aria-current`, not an ARIA tablist: a tablist
// promises a panel in the same document, and the panel here is the route's.
//
// It is the reference composition of `SectionNav` (icon, label, live summary,
// group headings, a note under the list); this file only says what the editor
// puts in it. It sits in a `SectionNavLayout frame="rail"` with the section and
// its preview, and is a row above them until that space is wide enough for a
// column beside them.

import { linkOptions } from '@tanstack/react-router'
import { CircleAlert, Lock } from 'lucide-react'
import { SectionNav } from '#/components/ui/section-nav'
import type { SectionNavItem } from '#/components/ui/section-nav-types'
import { PORTAL_EDITOR_SECTION_ICONS } from './portal-editor-section-icons'
import {
  PORTAL_EDITOR_SECTION_GROUPS,
  PORTAL_EDITOR_SECTION_LABELS,
  type PortalEditorSection,
} from './portal-editor-sections'
import type { PortalEditorSectionSummary } from './portal-editor-summary'

type Summaries = Readonly<Record<PortalEditorSection, PortalEditorSectionSummary>>

type ItemsInput = Readonly<{
  propertyId: string
  portalId: string
  available: ReadonlyArray<PortalEditorSection>
  summaries: Summaries
}>

function SectionSummary({ summary }: Readonly<{ summary: PortalEditorSectionSummary }>) {
  return (
    <>
      {summary.locked ? <Lock className="size-3 shrink-0" aria-hidden /> : null}
      <span className="truncate">{summary.text}</span>
      {summary.attention ? (
        <span className="flex shrink-0 items-center gap-1 text-foreground">
          <span aria-hidden>·</span>
          <CircleAlert className="size-3 text-warn" aria-hidden />
          {summary.attention}
        </span>
      ) : null}
    </>
  )
}

/** The available sections as nav items, grouped as guests meet them. */
export function portalEditorNavItems({
  propertyId,
  portalId,
  available,
  summaries,
}: ItemsInput): ReadonlyArray<SectionNavItem> {
  return PORTAL_EDITOR_SECTION_GROUPS.flatMap((group) =>
    group.sections
      .filter((section) => available.includes(section))
      .map((section): SectionNavItem => ({
        key: section,
        // Checked against the route, which a plain `to: string` would not be.
        ...linkOptions({
          to: '/properties/$propertyId/portals/$portalId',
          params: { propertyId, portalId },
          search: { tab: 'page', section },
        }),
        label: PORTAL_EDITOR_SECTION_LABELS[section],
        icon: PORTAL_EDITOR_SECTION_ICONS[section],
        summary: <SectionSummary summary={summaries[section]} />,
        group: group.heading,
      })),
  )
}

export function PortalEditorNav({
  active,
  ...input
}: ItemsInput & Readonly<{ active: PortalEditorSection }>) {
  return (
    <SectionNav
      aria-label="Editor sections"
      items={portalEditorNavItems(input)}
      current={active}
      footer="Edits stay in this draft until you publish. Printed codes keep working."
    />
  )
}
