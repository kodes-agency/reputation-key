import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Tabs as TabsPrimitive } from 'radix-ui'

import { cn } from '#/lib/utils'
import { LINE_TAB_CLASS, LINE_TABS_LIST_CLASS } from './tabs-line-styles'

// Two looks, two jobs. The `line` variant (underline, see `tabs-line-styles.ts`)
// is for a page's sibling views, and `LinkTabs` is its twin when each view is a
// route. The default pill is for a mode inside a component: a composer's Reply /
// Note, a dialog's choice. `TabsList` hands its variant to its triggers, so a
// trigger is drawn by the list it sits in.
type TabsVariant = NonNullable<VariantProps<typeof tabsListVariants>['variant']>

const TabsVariantContext = React.createContext<TabsVariant>('default')

function Tabs({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        'group/tabs flex gap-2 data-[orientation=horizontal]:flex-col',
        className,
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  'group/tabs-list inline-flex items-center text-muted-foreground group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col',
  {
    variants: {
      variant: {
        default:
          'w-fit justify-center rounded-lg bg-muted p-[3px] group-data-[orientation=horizontal]/tabs:h-9',
        line: LINE_TABS_LIST_CLASS,
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function TabsList({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const resolved: TabsVariant = variant ?? 'default'
  return (
    <TabsVariantContext value={resolved}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={resolved}
        className={cn(tabsListVariants({ variant: resolved }), className)}
        {...props}
      />
    </TabsVariantContext>
  )
}

const PILL_TAB_CLASS =
  "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:text-muted-foreground dark:hover:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.use(TabsVariantContext)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(variant === 'line' ? LINE_TAB_CLASS : PILL_TAB_CLASS, className)}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}

/**
 * The count beside a tab's label ("Workspace 6"): tabular figures in muted ink,
 * one anatomy for a Radix trigger and a `LinkTab` alike.
 */
function TabCount({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="tab-count"
      className={cn('tabular-nums text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabCount }
