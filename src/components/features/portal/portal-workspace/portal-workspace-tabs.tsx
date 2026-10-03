// The workspace's tab strip. Each tab is a link to the same route with a
// different `?tab=`, so the browser's Back button steps between tabs and every
// tab has an address that can be shared or bookmarked. That is why this is a
// navigation landmark with `aria-current`, not an ARIA tablist: a tablist
// promises a panel in the same document, and the panel here is the route below.
// The strip is `LinkTabs`, the Link-backed twin of the line Tabs, so it wears
// the same underline as every other page-level view switch; this file adds the
// full-bleed band's gutter and the tabs' names.

import { Link } from '@tanstack/react-router'
import { LinkTab, LinkTabs } from '#/components/ui/link-tabs'
import { PAGE_GUTTER_X } from '#/components/layout/page-shell'
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
    <LinkTabs aria-label="Portal sections" className={PAGE_GUTTER_X}>
      {tabs.map((tab) => (
        <LinkTab key={tab} active={tab === activeTab}>
          <Link
            to="/properties/$propertyId/portals/$portalId"
            params={{ propertyId, portalId }}
            search={{ tab }}
          >
            {TAB_LABELS[tab]}
          </Link>
        </LinkTab>
      ))}
    </LinkTabs>
  )
}
