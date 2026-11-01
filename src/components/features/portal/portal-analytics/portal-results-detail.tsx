import { lazy, Suspense, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import { RowButton as Button } from '#/components/ui/button-layouts'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'

const PortalResultsDetailBody = lazy(() => import('./portal-results-detail-body'))

export function PortalResultsDetail({ data }: Readonly<{ data: PortalAnalyticsData }>) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost">
          More detail
          <ChevronDown aria-hidden="true" className={open ? 'rotate-180' : undefined} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Suspense fallback={null}>
          <PortalResultsDetailBody data={data} />
        </Suspense>
      </CollapsibleContent>
    </Collapsible>
  )
}
