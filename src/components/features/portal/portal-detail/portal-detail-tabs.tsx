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
  children,
}: Readonly<{
  value: string
  onValueChange: (v: string) => void
  children?: ReactNode
}>) {
  return (
    <Tabs value={value} onValueChange={onValueChange}>
      <TabsList>
        {TABS.map(({ value: v, Icon, label }) => (
          <TabsTrigger key={v} value={v} className="gap-1.5">
            <Icon className="size-3.5" /> {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {TABS.map(({ value: v }) => (
        <TabsContent key={v} value={v} forceMount hidden={value !== v ? true : undefined}>
          {value === v ? children : null}
        </TabsContent>
      ))}
    </Tabs>
  )
}
