// Portal detail tab strip — extracted for line-count compliance.
// Renders a TabsContent panel for every tab (forceMount) so each TabsTrigger's
// aria-controls idref resolves to a real element (otherwise axe flags
// aria-valid-attr-value). Only the active tab's children actually mount — the
// parent passes the active panel via `children` — so behaviour is unchanged.
import { Tabs, TabsList, TabsTrigger, TabsContent } from '#/components/ui/tabs'
import { Settings, Link2, Share2, BarChart3 } from 'lucide-react'
import type { ReactNode } from 'react'

const TABS = [
  { value: 'settings', Icon: Settings, label: 'Settings' },
  { value: 'links', Icon: Link2, label: 'Links' },
  { value: 'share', Icon: Share2, label: 'Share' },
  { value: 'analytics', Icon: BarChart3, label: 'Analytics' },
] as const

export function PortalDetailTabs({
  value,
  onValueChange,
  hiddenTabs,
  children,
}: Readonly<{
  value: (typeof TABS)[number]['value']
  onValueChange: (value: (typeof TABS)[number]['value']) => void
  /**
   * Tabs whose backing capability the caller resolved as absent. They get
   * neither a trigger nor a panel — the tab used to render the server's raw
   * policy-denial reason once opened.
   */
  hiddenTabs?: ReadonlyArray<(typeof TABS)[number]['value']>
  children?: ReactNode
}>) {
  // Annotated: the ternary otherwise yields a union of a tuple and an array,
  // which TS refuses to call .map on.
  const tabs: ReadonlyArray<(typeof TABS)[number]> =
    hiddenTabs === undefined || hiddenTabs.length === 0
      ? TABS
      : TABS.filter(({ value: tabValue }) => !hiddenTabs.includes(tabValue))
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(next as (typeof TABS)[number]['value'])}
    >
      <div className="w-full overflow-x-auto pb-1">
        <TabsList className="min-w-max">
          {tabs.map(({ value: tabValue, Icon, label }) => (
            <TabsTrigger
              key={tabValue}
              value={tabValue}
              className="min-h-11 gap-1.5 px-3 sm:min-h-9"
            >
              <Icon className="size-3.5" /> {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map(({ value: v }) => (
        <TabsContent key={v} value={v} forceMount hidden={value !== v ? true : undefined}>
          {value === v ? children : null}
        </TabsContent>
      ))}
    </Tabs>
  )
}
