// The editor's section list: every part of the portal page, in the order guests
// meet it, then what only managers see. Each entry is a link to the same route
// with a different `?section=`, so the browser's Back button steps between
// sections and each has an address that can be shared. That makes this a
// navigation landmark with `aria-current`, not an ARIA tablist: a tablist
// promises a panel in the same document, and the panel here is the route's.
//
// Below `xl` (phones, tablets and small laptops, where the form and the preview
// need the width) the list becomes one scrolling row: the side that continues
// fades, and the open section scrolls into view, with the Inbox queue strip's
// own measuring and mask (an inline style, so no stylesheet bytes). The group
// headings and the summary lines belong to the wider layout.
//
// Each entry names its ink, active and inactive, and its icon follows it: the
// global link colour is a default in `@layer base`, so these utilities win.

import { useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { CircleAlert, Lock } from 'lucide-react'
import { cn } from '#/lib/utils'
import { useStripOverflow } from '#/components/inbox/use-strip-overflow'
import {
  STRIP_FADE_PX,
  stripFadeStyle,
  stripScrollLeftFor,
} from '#/components/inbox/inbox-queue-strip-scroll'
import { PORTAL_EDITOR_SECTION_ICONS } from './portal-editor-section-icons'
import {
  PORTAL_EDITOR_SECTION_GROUPS,
  PORTAL_EDITOR_SECTION_LABELS,
  type PortalEditorSection,
} from './portal-editor-sections'
import type { PortalEditorSectionSummary } from './portal-editor-summary'

type Props = Readonly<{
  propertyId: string
  portalId: string
  active: PortalEditorSection
  available: ReadonlyArray<PortalEditorSection>
  summaries: Readonly<Record<PortalEditorSection, PortalEditorSectionSummary>>
}>

export function PortalEditorNav({
  propertyId,
  portalId,
  active,
  available,
  summaries,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null)
  const edges = useStripOverflow(stripRef)

  // Bring the open section into the row, sideways only: scrolling the page to
  // the strip would jump away from the form being edited. In the column (xl)
  // everything is in view, so nothing moves.
  useEffect(() => {
    const strip = stripRef.current
    const link = strip?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!strip || !link) return
    const left = stripScrollLeftFor({
      pillLeft: link.offsetLeft,
      pillWidth: link.offsetWidth,
      scrollLeft: strip.scrollLeft,
      clientWidth: strip.clientWidth,
      padding: STRIP_FADE_PX,
    })
    if (left !== null) strip.scrollTo({ left })
  }, [active])

  return (
    <nav
      aria-label="Editor sections"
      className="border-b xl:w-72 xl:shrink-0 xl:self-stretch xl:border-r xl:border-b-0"
    >
      {/* One scrolling row below xl; a sticky column beside the section from xl. */}
      <div className="xl:sticky xl:top-0">
        <div
          ref={stripRef}
          className="relative flex scroll-px-6 gap-1 overflow-x-auto px-4 py-2 md:px-6 xl:flex-col xl:gap-5 xl:px-3 xl:py-5"
          style={stripFadeStyle(edges)}
        >
          {PORTAL_EDITOR_SECTION_GROUPS.map((group) => {
            const sections = group.sections.filter((section) =>
              available.includes(section),
            )
            if (sections.length === 0) return null
            return (
              <div key={group.heading} className="max-xl:contents">
                <p className="hidden px-3 pb-1 text-xs font-medium text-muted-foreground xl:block">
                  {group.heading}
                </p>
                <ul className="flex gap-1 xl:flex-col">
                  {sections.map((section) => (
                    <li key={section} className="max-xl:shrink-0">
                      <SectionLink
                        propertyId={propertyId}
                        portalId={portalId}
                        section={section}
                        isActive={section === active}
                        summary={summaries[section]}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
        <p className="hidden px-6 pb-5 text-xs text-muted-foreground xl:block">
          Edits stay in this draft until you publish. Printed codes keep working.
        </p>
      </div>
    </nav>
  )
}

function SectionLink({
  propertyId,
  portalId,
  section,
  isActive,
  summary,
}: Readonly<{
  propertyId: string
  portalId: string
  section: PortalEditorSection
  isActive: boolean
  summary: PortalEditorSectionSummary
}>) {
  const Icon = PORTAL_EDITOR_SECTION_ICONS[section]
  return (
    <Link
      to="/properties/$propertyId/portals/$portalId"
      params={{ propertyId, portalId }}
      search={{ tab: 'page', section }}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
        'hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
        isActive ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block whitespace-nowrap text-foreground">
          {PORTAL_EDITOR_SECTION_LABELS[section]}
        </span>
        <span className="hidden items-center gap-1 truncate text-xs font-normal text-muted-foreground xl:flex">
          {summary.locked ? <Lock className="size-3 shrink-0" aria-hidden /> : null}
          <span className="truncate">{summary.text}</span>
          {summary.attention ? (
            <span className="flex shrink-0 items-center gap-1 text-foreground">
              <span aria-hidden>·</span>
              <CircleAlert className="size-3 text-warn" aria-hidden />
              {summary.attention}
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  )
}
