// Portal detail tab bar — drives tab selection via search params
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { Settings, Link2, Share2, BarChart3 } from 'lucide-react'

const _VALID_TABS = ['settings', 'links', 'share', 'analytics'] as const
export type TabName = (typeof _VALID_TABS)[number]

type Props = Readonly<{
  currentTab: TabName
  onChange: (value: string) => void
}>

export function PortalDetailTabBar({ currentTab, onChange }: Props) {
  return (
    <Tabs value={currentTab} onValueChange={onChange}>
      <TabsList>
        <TabsTrigger value="settings" className="gap-1.5">
          <Settings className="size-3.5" /> Settings
        </TabsTrigger>
        <TabsTrigger value="links" className="gap-1.5">
          <Link2 className="size-3.5" /> Links
        </TabsTrigger>
        <TabsTrigger value="share" className="gap-1.5">
          <Share2 className="size-3.5" /> Share
        </TabsTrigger>
        <TabsTrigger value="analytics" className="gap-1.5">
          <BarChart3 className="size-3.5" /> Analytics
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
