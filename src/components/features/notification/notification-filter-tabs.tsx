// Filter tabs shared by the bell popover and the /notifications page.
//
// One `TabsContent` per option (the repo's Tabs precedent) so every trigger's
// `aria-controls` resolves; Radix mounts only the active panel, so `children`
// renders exactly once.

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
}>

export function NotificationFilterTabs({
  value,
  onChange,
  children,
  className,
  listClassName,
}: Props) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange(parseNotificationFilter(next))}
      className={cn('gap-0', className)}
    >
      <TabsList
        variant="line"
        aria-label="Filter notifications"
        className={cn('h-auto w-full flex-wrap justify-start gap-x-1', listClassName)}
      >
        {NOTIFICATION_FILTERS.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            className="flex-none text-xs"
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {NOTIFICATION_FILTERS.map((option) => (
        <TabsContent key={option.value} value={option.value}>
          {children}
        </TabsContent>
      ))}
    </Tabs>
  )
}
