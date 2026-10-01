// The editor's section list: every part of the portal page, in the order guests
// meet it, then what only managers see. Each entry is a link to the same route
// with a different `?section=`, so the browser's Back button steps between
// sections and each has an address that can be shared. That makes this a
// navigation landmark with `aria-current`, not an ARIA tablist: a tablist
// promises a panel in the same document, and the panel here is the route's.
//
// On a phone the list becomes one scrolling row; the group headings and the
// summary lines belong to the wider layout.

import { Link } from '@tanstack/react-router'
import {
  CircleAlert,
  Languages,
  Layers,
  LayoutGrid,
  Lock,
  MessageSquareText,
  Palette,
  PanelBottom,
  Star,
  Type,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '#/lib/utils'
import {
  PORTAL_EDITOR_SECTION_GROUPS,
  PORTAL_EDITOR_SECTION_LABELS,
  type PortalEditorSection,
} from './portal-editor-sections'
import type { PortalEditorSectionSummary } from './portal-editor-summary'

const SECTION_ICONS: Readonly<Record<PortalEditorSection, LucideIcon>> = {
  look: Palette,
  welcome: Type,
  rating: Star,
  'private-note': MessageSquareText,
  linktree: LayoutGrid,
  footer: PanelBottom,
  languages: Languages,
  group: Layers,
  responsible: UserRound,
}

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
  return (
    <nav
      aria-label="Editor sections"
      className="border-b lg:w-72 lg:shrink-0 lg:self-stretch lg:border-r lg:border-b-0"
    >
      {/* One scrolling row on a phone; a sticky column beside the section from lg. */}
      <div className="lg:sticky lg:top-0">
        <div className="flex gap-1 overflow-x-auto px-4 py-2 md:px-6 lg:flex-col lg:gap-5 lg:px-3 lg:py-5">
          {PORTAL_EDITOR_SECTION_GROUPS.map((group) => {
            const sections = group.sections.filter((section) =>
              available.includes(section),
            )
            if (sections.length === 0) return null
            return (
              <div key={group.heading} className="max-lg:contents">
                <p className="hidden px-3 pb-1 text-xs font-medium text-muted-foreground lg:block">
                  {group.heading}
                </p>
                <ul className="flex gap-1 lg:flex-col">
                  {sections.map((section) => (
                    <li key={section} className="max-lg:shrink-0">
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
        <p className="hidden px-6 pb-5 text-xs text-muted-foreground lg:block">
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
  const Icon = SECTION_ICONS[section]
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
        <span className="hidden items-center gap-1 truncate text-xs font-normal text-muted-foreground lg:flex">
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
