// Filter tabs shared by the bell popover and the /notifications page.
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
        // The vendored list pins its height with a group variant, which a
        // plain `h-auto` cannot outrank; wrapped tabs then spilled over the
        // list below on a phone.
        className={cn(
          'w-full flex-wrap justify-start gap-x-1 group-data-[orientation=horizontal]/tabs:h-auto',
          listClassName,
        )}
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
        <TabsContent key={option.value} value={option.value} className={contentClassName}>
          {children}
        </TabsContent>
      ))}
    </Tabs>
  )
}
