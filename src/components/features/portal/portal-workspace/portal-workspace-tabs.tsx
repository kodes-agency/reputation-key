// The workspace's tab strip. Each tab is a link to the same route with a
// different `?tab=`, so the browser's Back button steps between tabs and every
// tab has an address that can be shared or bookmarked. That is why this is a
// navigation landmark with `aria-current`, not an ARIA tablist: a tablist
// promises a panel in the same document, and the panel here is the route below.
// The ink is pinned (`!`): the global link colour is unlayered and would
// otherwise paint every tab the accent, leaving only the underline to say
// which one is open.

import { Link } from '@tanstack/react-router'
import { cn } from '#/lib/utils'
import {
  PORTAL_DETAIL_TABS,
  type PortalDetailTab,
} from '../portal-detail/portal-detail-rules'

const TAB_LABELS: Readonly<Record<PortalDetailTab, string>> = {
  page: 'Page',
  share: 'Share',
  results: 'Results',
  history: 'History',
}

type Props = Readonly<{
  propertyId: string
  portalId: string
  activeTab: PortalDetailTab
  /** Tabs the caller resolved as unavailable. They get no link at all. */
  hiddenTabs: ReadonlyArray<PortalDetailTab>
}>

export function PortalWorkspaceTabs({
  propertyId,
  portalId,
  activeTab,
  hiddenTabs,
}: Props) {
  const tabs = PORTAL_DETAIL_TABS.filter((tab) => !hiddenTabs.includes(tab))
  return (
    <nav aria-label="Portal sections" className="overflow-x-auto border-b px-4 md:px-6">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = tab === activeTab
          return (
            <li key={tab}>
              <Link
                to="/properties/$propertyId/portals/$portalId"
                params={{ propertyId, portalId }}
                search={{ tab }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-11 items-center px-3 text-sm transition-colors',
                  'after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent',
                  'hover:text-foreground! focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                  active
                    ? 'font-medium text-foreground! after:bg-primary'
                    : 'text-muted-foreground!',
                )}
              >
                {TAB_LABELS[tab]}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
