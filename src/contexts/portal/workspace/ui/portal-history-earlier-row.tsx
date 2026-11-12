// "3 earlier versions · 14 Jul, 9 Apr and 12 Mar · Show": the older versions on
// All, folded into one line so a long history reads as the recent past first.

import { History } from 'lucide-react'
import type { PortalVersionItem } from '#/contexts/portal/application/portal-management-contracts'
import { Button } from '#/components/ui/button'
import {
  TimelineConnector,
  TimelineContent,
  TimelineIndicator,
  TimelineItem,
} from '#/components/ui/timeline'
import { usePortalHistory } from './portal-history-context'
import { formatHistoryTime } from './portal-history-time'

export function PortalHistoryEarlierRow({
  versions,
}: Readonly<{ versions: readonly PortalVersionItem[] }>) {
  const { now, timeZone, showEarlierVersions } = usePortalHistory()
  const dates = versions.map(
    (version) => formatHistoryTime(version.publishedAt, now, timeZone).label,
  )
  const last = dates.at(-1)
  const list =
    dates.length > 1 ? `${dates.slice(0, -1).join(', ')} and ${last}` : (last ?? '')
  return (
    <TimelineItem role="listitem">
      <TimelineConnector />
      <TimelineIndicator size="sm">
        <History aria-hidden="true" />
      </TimelineIndicator>
      <TimelineContent>
        <p className="flex flex-wrap items-center gap-x-1 py-0.5 text-sm text-muted-foreground">
          <span>
            {versions.length} earlier versions · {list} ·
          </span>
          <Button
            type="button"
            variant="link"
            size="inline"
            className="text-sm"
            aria-label={`Show ${versions.length} earlier versions`}
            onClick={() => {
              const first = versions[0]
              if (first) showEarlierVersions(first.version)
            }}
          >
            Show
          </Button>
        </p>
      </TimelineContent>
    </TimelineItem>
  )
}
