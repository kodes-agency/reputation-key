// The /notifications page's filter: Needs you, Updates and All, drawn as the same
// underline as every page-level view switch. Each option is a search value of the
// route (`?filter=`), so the filter is a `LinkTabs` (decision 7 of the UI
// consistency plan): a filtered view has an address, a reload or a shared link
// reads the same feed, and Back steps between the filters as it does between
// People's views. It is a navigation landmark with `aria-current`, not an ARIA
// tablist, because the feed below is the route's, and the property filter beside
// it travels with the link.
//
// Choosing is a link, so a keyboard user passing one does not start a server read
// for it: arrows are not a thing here, Tab moves between links and Enter follows
// one. (The Radix tablist this replaced needed `activationMode="manual"` for that.)
import type { ReactNode } from 'react'
import { LinkTab, LinkTabs } from '#/components/ui/link-tabs'
import { NOTIFICATION_FILTERS, type NotificationFilter } from './notification-filters'

type Props = Readonly<{
  /** The filter the page is on, which is the route's `filter`. */
  value: NotificationFilter
  /** The feed for `value`. */
  children: ReactNode
  className?: string
}>

export function NotificationFilterTabs({ value, children, className }: Props) {
  return (
    <div className={className}>
      <LinkTabs aria-label="Filter notifications">
        {NOTIFICATION_FILTERS.map((option) => (
          <LinkTab
            key={option.value}
            to="/notifications"
            search={(previous) => ({ ...previous, filter: option.value })}
            current={option.value === value}
          >
            {option.label}
          </LinkTab>
        ))}
      </LinkTabs>
      {children}
    </div>
  )
}
