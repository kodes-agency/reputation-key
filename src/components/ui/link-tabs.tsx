// The Link-backed twin of `Tabs variant="line"`: sibling views that are each a route
// (or a search value of one), so every view has an address and Back steps between
// them. A navigation landmark of links with `aria-current`, not an ARIA tablist: a
// tablist promises a panel in the same document. The look comes from the same
// recipe as the Radix line tabs (`tabs-line-styles.ts`).
//
//   <LinkTabs aria-label="Google rating goal views">
//     <LinkTab to="/goals" search={{ view: 'active' }} current={view === 'active'}>
//       Active
//     </LinkTab>
//   </LinkTabs>
//
// A `LinkTab` takes a router link's props plus `current`. The router's own active
// test never speaks, so a bare `/list` beside `/list?tab=removed` is not also
// announced as current.
//
// The row keeps one line, scrolls sideways, hides its scrollbar, fades the side
// that continues and scrolls the current tab into view.
import { useRef, type ComponentProps } from 'react'

import { cn } from '#/lib/utils'
import { NavLink } from './nav-link'
import { stripFadeStyle } from './strip-scroll'
import { LINE_TAB_CLASS, LINE_TABS_LIST_CLASS } from './tabs-line-styles'
import { useRevealCurrentItem } from './use-reveal-current-item'
import { useStripOverflow } from './use-strip-overflow'

type LinkTabsProps = Omit<ComponentProps<'nav'>, 'aria-label' | 'aria-labelledby'> &
  (
    | { 'aria-label': string; 'aria-labelledby'?: undefined }
    | { 'aria-labelledby': string; 'aria-label'?: undefined }
  )

/**
 * The landmark and its list. Named, because a page can hold more than one
 * navigation. The list scrolls sideways rather than wrapping, so a narrow phone
 * keeps one row; a full-bleed band passes its gutter in `className`.
 */
function LinkTabs({ className, style, children, ...props }: LinkTabsProps) {
  const scrollerRef = useRef<HTMLElement>(null)
  const edges = useStripOverflow(scrollerRef)
  useRevealCurrentItem(scrollerRef)
  return (
    <nav
      ref={scrollerRef}
      data-slot="link-tabs"
      style={{ ...stripFadeStyle(edges), ...style }}
      className={cn(
        'flex scroll-px-6 overflow-x-auto [scrollbar-width:none]',
        LINE_TABS_LIST_CLASS,
        className,
      )}
      {...props}
    >
      <ul className="flex min-w-max gap-1">{children}</ul>
    </nav>
  )
}

/**
 * One view: a router link that is the current page only when `current` says so,
 * drawn as a line tab. Typed as `NavLink` is, so `to`, `params` and `search` are
 * checked against the route tree.
 */
const LinkTab = (({ className, ...props }: ComponentProps<typeof NavLink>) => (
  <li data-slot="link-tab-item">
    <NavLink
      data-slot="link-tab"
      data-state={props.current ? 'active' : 'inactive'}
      className={cn(LINE_TAB_CLASS, className)}
      {...props}
    />
  </li>
)) as typeof NavLink

export { LinkTabs, LinkTab }
