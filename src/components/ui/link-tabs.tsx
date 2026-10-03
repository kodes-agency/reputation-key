// The Link-backed twin of `Tabs variant="line"`: a page's sibling views when each
// view is a route (or a search value of one), so every view has an address, the
// browser's Back button steps between them and a view can be bookmarked. It is a
// navigation landmark of links with `aria-current`, not an ARIA tablist: a
// tablist promises a panel in the same document, and the panel here is the route
// below. The look is not part of that split, so it comes from the same recipe
// as the Radix line tabs (`tabs-line-styles.ts`).
//
//   <LinkTabs aria-label="Goal views">
//     <LinkTab active={view === 'active'}>
//       <Link to="/goals" search={{ view: 'active' }}>Active</Link>
//     </LinkTab>
//   </LinkTabs>
//
// `LinkTab` takes its link as the child (a router `Link` or a plain `<a>`), so
// this file imports no router. Give a router Link `activeOptions={{ exact: true }}`
// when one view's search is a subset of another's (a bare `/list` beside
// `/list?tab=removed`): the router otherwise calls the bare link active too, and
// writes `aria-current` over `active`.
import * as React from 'react'
import { Slot } from 'radix-ui'

import { cn } from '#/lib/utils'
import { LINE_TAB_CLASS, LINE_TABS_LIST_CLASS } from './tabs-line-styles'

type LinkTabsProps = Omit<React.ComponentProps<'nav'>, 'aria-label' | 'aria-labelledby'> &
  (
    | { 'aria-label': string; 'aria-labelledby'?: undefined }
    | { 'aria-labelledby': string; 'aria-label'?: undefined }
  )

/**
 * The landmark and its list. Named, because a page can hold more than one
 * navigation. The list scrolls sideways rather than wrapping, so a narrow phone
 * keeps one row; a full-bleed band passes its gutter in `className`.
 */
function LinkTabs({ className, children, ...props }: LinkTabsProps) {
  return (
    <nav
      data-slot="link-tabs"
      className={cn('flex overflow-x-auto', LINE_TABS_LIST_CLASS, className)}
      {...props}
    >
      <ul className="flex min-w-max gap-1">{children}</ul>
    </nav>
  )
}

type LinkTabProps = Omit<React.ComponentProps<typeof Slot.Root>, 'children'> & {
  /** This view is the one on screen: `aria-current="page"`, the underline. */
  active: boolean
  /** The link itself. */
  children: React.ReactElement
}

function LinkTab({ active, className, children, ...props }: LinkTabProps) {
  return (
    <li data-slot="link-tab-item">
      <Slot.Root
        data-slot="link-tab"
        data-state={active ? 'active' : 'inactive'}
        aria-current={active ? 'page' : undefined}
        className={cn(LINE_TAB_CLASS, className)}
        {...props}
      >
        {children}
      </Slot.Root>
    </li>
  )
}

export { LinkTabs, LinkTab }
