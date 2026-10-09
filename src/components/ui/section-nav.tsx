import { use, useId, useRef, type ReactNode } from 'react'
import { cn } from '#/lib/utils'
import { NavCount } from './nav-count'
import { NavLink } from './nav-link'
import { SectionNavFrameContext } from './section-nav-layout'
import { groupSectionNavItems, type SectionNavGroup } from './section-nav-groups'
import {
  SECTION_NAV_ICON,
  SECTION_NAV_ROW,
  SECTION_NAV_ROW_HEIGHT,
  sectionNavClasses,
  type SectionNavFrame,
  type SectionNavPresentation,
} from './section-nav-styles'
import type { SectionNavItem } from './section-nav-types'
import { stripFadeStyle } from './strip-scroll'
import { useRevealCurrentItem } from './use-reveal-current-item'
import { useStripOverflow } from './use-strip-overflow'

// A list of the sections of one place, each a link to its own address: a Property's
// settings, the Portal editor's page parts. It is a navigation landmark with
// `aria-current`, not an ARIA tablist, because the panel is the route's, not this
// document's. Extracted from the Portal editor's section list with its look intact.
//
// - Items carry an optional icon, a summary line (a live value or a description), a
//   trailing count and a group; a group is a run of neighbours under a heading.
// - It is a strip (one scrolling row: the side that continues fades, the open item
//   scrolls into view, no scrollbar) or a list, or `auto`: a strip until the
//   container it sits in is wide enough (see `SectionNavLayout`). The side that
//   continues fades: that is the cue, as in every strip, not a chevron.
// - The current row wears the sidebar's accent-muted fill, drawn from the
//   `aria-current` that `NavLink` sets from `current`, so what is drawn and what is
//   announced are one answer. Hover and keyboard focus are shared by every row.
//
// The Inbox queue rail and strip keep their own composition (they are buttons that
// change a filter, and the strip is a bar of pills) but wear this fill, this focus
// ring and `NavCount`.

type Props = Readonly<{
  'aria-label': string
  items: ReadonlyArray<SectionNavItem>
  /** The key of the item that is the page the person is on; null when none is. */
  current: string | null
  presentation?: SectionNavPresentation
  /** Print each group's heading in a list. Default on. */
  groupHeadings?: boolean
  /** A note under a list, left out of a strip. */
  footer?: ReactNode
  /** Overrides the frame the surrounding `SectionNavLayout` gives. */
  frame?: SectionNavFrame
}>

function Row({
  item,
  current,
  frame,
  presentation,
}: Readonly<{
  item: SectionNavItem
  current: boolean
  frame: SectionNavFrame
  presentation: SectionNavPresentation
}>) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      {...(item.params ? { params: item.params } : {})}
      {...(item.search ? { search: item.search } : {})}
      current={current}
      className={cn(SECTION_NAV_ROW, SECTION_NAV_ROW_HEIGHT[frame])}
    >
      {Icon ? <Icon className={SECTION_NAV_ICON} aria-hidden="true" /> : null}
      <span className="min-w-0 flex-1">
        <span data-slot="section-nav-label" className="block whitespace-nowrap">
          {item.label}
        </span>
        {item.summary ? (
          <span
            data-slot="section-nav-summary"
            className={sectionNavClasses(frame, 'summary', presentation)}
          >
            {item.summary}
          </span>
        ) : null}
      </span>
      {item.marker ? (
        <span
          data-slot="section-nav-marker"
          className={sectionNavClasses(frame, 'marker', presentation)}
        >
          {item.marker}
        </span>
      ) : null}
      {item.count ? <NavCount>{item.count}</NavCount> : null}
    </NavLink>
  )
}

function Group({
  group,
  showHeading,
  current,
  frame,
  presentation,
}: Readonly<{
  group: SectionNavGroup
  showHeading: boolean
  current: string | null
  frame: SectionNavFrame
  presentation: SectionNavPresentation
}>) {
  const headingId = useId()
  const heading = showHeading ? group.heading : null
  return (
    <div>
      {heading ? (
        <p
          id={headingId}
          data-slot="section-nav-heading"
          className={sectionNavClasses(frame, 'heading', presentation)}
        >
          {heading}
        </p>
      ) : null}
      <ul
        {...(heading ? { 'aria-labelledby': headingId } : {})}
        className={sectionNavClasses(frame, 'list', presentation)}
      >
        {group.items.map((item) => (
          <li key={item.key} className="shrink-0">
            <Row
              item={item}
              current={item.key === current}
              frame={frame}
              presentation={presentation}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SectionNav({
  'aria-label': ariaLabel,
  items,
  current,
  presentation = 'auto',
  groupHeadings = true,
  footer,
  frame: frameProp,
}: Props) {
  const frame = frameProp ?? use(SectionNavFrameContext) ?? 'inline'
  const scrollerRef = useRef<HTMLDivElement>(null)
  const edges = useStripOverflow(scrollerRef)

  // Bring the open item into the row, sideways only: scrolling the page to the strip
  // would jump away from the content being read. It happens when the open section
  // changes and again when the row or its content resizes (a web font arriving, the
  // phone turning), unless the person has scrolled the row since. In a list nothing
  // is out of reach, so nothing moves.
  useRevealCurrentItem(scrollerRef)

  return (
    <nav
      aria-label={ariaLabel}
      data-slot="section-nav"
      data-presentation={presentation}
      className={sectionNavClasses(frame, 'nav', presentation)}
    >
      <div
        ref={scrollerRef}
        data-slot="section-nav-scroller"
        style={stripFadeStyle(edges)}
        className={sectionNavClasses(frame, 'scroller', presentation)}
      >
        {groupSectionNavItems(items).map((group) => (
          <Group
            key={group.key}
            group={group}
            showHeading={groupHeadings}
            current={current}
            frame={frame}
            presentation={presentation}
          />
        ))}
        {footer ? (
          <div className={sectionNavClasses(frame, 'footer', presentation)}>{footer}</div>
        ) : null}
      </div>
    </nav>
  )
}
