// The /notifications page's filter tabs: the same underline as every page-level
// view switch (`Tabs variant="line"`), kept as a tablist because each option
// swaps the feed panel below in this document and the filter replaces history
// rather than adding to it (`LinkTabs` is for views that are a route).
//
// One `TabsContent` per option (the repo's Tabs precedent) so every trigger's
// `aria-controls` resolves; Radix mounts only the active panel, so `children`
// renders exactly once.
//
// Activation is manual: arrows move focus, Enter or Space chooses. Each tab
// starts a server read, so automatic activation fired a request (and a
// loading flash) for every tab a keyboard user merely passed.

import type { ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { cn } from '#/lib/utils'
import {
  NOTIFICATION_FILTERS,
  parseNotificationFilter,
  type NotificationFilter,
} from './notification-filters'

type Props = Readonly<{
  value: NotificationFilter
  onChange: (value: NotificationFilter) => void
  children: ReactNode
  className?: string
  listClassName?: string
  contentClassName?: string
}>

export function NotificationFilterTabs({
  value,
  onChange,
  children,
  className,
  listClassName,
  contentClassName,
}: Props) {
  return (
    <Tabs
      value={value}
      activationMode="manual"
      onValueChange={(next) => onChange(parseNotificationFilter(next))}
      className={cn('gap-0', className)}
    >
      <TabsList
        variant="line"
        aria-label="Filter notifications"
        className={listClassName}
      >
        {NOTIFICATION_FILTERS.map((option) => (
          <TabsTrigger key={option.value} value={option.value}>
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {NOTIFICATION_FILTERS.map((option) => (
        <TabsContent key={option.value} value={option.value} className={contentClassName}>
          {children}
        </TabsContent>
      ))}
    </Tabs>
  )
}
