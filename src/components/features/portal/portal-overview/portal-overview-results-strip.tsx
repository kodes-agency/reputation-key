// The Portals overview's results strip (boards 01, 10 and 11): the window the
// figures cover and its five measures over every Portal of the Property (or, on
// the All properties page, of the whole Organization), in the same ruled strip a
// single Portal's Results tab prints. The range is a viewing
// preference that follows the reader from the Results tab (All Time is not
// offered: a lifetime figure comes from the lifetime aggregate, not from readings).
import { Button } from '#/components/ui/button'
import { Metric, MetricStrip } from '#/components/ui/metric-strip'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { cn } from '#/lib/utils'
import type { PortalResultsTimeRange } from '#/contexts/reporting/application/public-api'
import { timeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'
import { RESULTS_LABELS } from '../portal-analytics/portal-results-cells'
import { PortalResultsStrip } from '../portal-analytics/portal-results-strip'
import { PORTAL_OVERVIEW_RANGES } from '../portal-analytics/portal-results-window'
import type { PortalOverviewResultsState } from './portal-overview-results'
import { organizationScopeLine } from './portal-overview-strip-scope'

/** What the route tells the page about the results: where they are, and the window. */
export type PortalOverviewResultsControls = Readonly<{
  state: PortalOverviewResultsState
  timeRange: PortalResultsTimeRange
  onTimeRangeChange: (timeRange: PortalResultsTimeRange) => void
  onRetry: () => void
  /** The figures shown are the previous range's while the new ones load. */
  busy?: boolean
}>

type Props = Readonly<{
  controls: PortalOverviewResultsControls
  /** The Property the strip is for; null is the whole Organization. */
  propertyId: string | null
  /** Organization strip: how many Properties the list shows, to say when the total has fewer. */
  propertiesListed?: number
  /** One group's own figures (a group's page) instead of every Portal of the Property. */
  groupId?: string
}>

const COLLAPSE_NOTE = 'collapsed properties stay collapsed for you'

function stripOf(
  state: PortalOverviewResultsState,
  propertyId: string | null,
  groupId: string | undefined,
) {
  if (state.status !== 'ready') return null
  if (propertyId === null) return state.index.total()
  return groupId === undefined
    ? state.index.strip(propertyId)
    : state.index.groupStrip(groupId)
}

/** "1–30 Sep, Europe/Sofia time · all portals", or on the Organization's page "all properties". */
function scopeLine(
  state: PortalOverviewResultsState,
  strip: ReturnType<typeof stripOf>,
  propertyId: string | null,
  propertiesListed: number | undefined,
  groupId: string | undefined,
): string {
  const everything =
    propertyId === null
      ? organizationScopeLine(
          state.status === 'ready' ? state.index.propertiesRead : null,
          propertiesListed,
        )
      : groupId === undefined
        ? 'all portals'
        : 'this group'
  return strip?.caption ? `${strip.caption} · ${everything}` : everything
}

function LoadingStrip() {
  return (
    <div aria-busy="true">
      <MetricStrip aria-label="Portal results" variant="ruled">
        {Object.values(RESULTS_LABELS).map((label) => (
          <Metric key={label} label={label} state="loading" />
        ))}
      </MetricStrip>
    </div>
  )
}

function FailedStrip({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3"
    >
      <p className="text-sm text-muted-foreground">
        Results couldn’t be loaded. The portals below are unaffected.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 sm:min-h-9"
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  )
}

export function PortalOverviewResultsStrip({
  controls,
  propertyId,
  propertiesListed,
  groupId,
}: Props) {
  const { state, timeRange, onTimeRangeChange, onRetry, busy = false } = controls
  if (state.status === 'off') return null
  const strip = stripOf(state, propertyId, groupId)
  return (
    <section aria-label="Results" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Select
          value={timeRange}
          onValueChange={(value) => {
            const parsed = timeRangePreset.safeParse(value)
            if (parsed.success && parsed.data !== 'all') onTimeRangeChange(parsed.data)
          }}
        >
          <SelectTrigger aria-label="Time range" className="min-h-11 min-w-40 sm:min-h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {PORTAL_OVERVIEW_RANGES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {scopeLine(state, strip, propertyId, propertiesListed, groupId)}
        </p>
      </div>
      {state.status === 'loading' ? <LoadingStrip /> : null}
      {state.status === 'failed' ? <FailedStrip onRetry={onRetry} /> : null}
      {strip ? (
        <div className={cn('transition-opacity', busy && 'opacity-60')} aria-busy={busy}>
          <PortalResultsStrip cells={strip.cells} />
        </div>
      ) : null}
    </section>
  )
}

/** The footer line under the table: the window, the zone and the floor for an average. */
export function PortalOverviewResultsFooter({ controls, propertyId, groupId }: Props) {
  const { state, busy = false } = controls
  const strip = stripOf(state, propertyId, groupId)
  if (!strip) return null
  return (
    <p
      aria-busy={busy}
      className={cn(
        'text-xs text-muted-foreground transition-opacity',
        busy && 'opacity-60',
      )}
    >
      {propertyId === null ? `${strip.footer} · ${COLLAPSE_NOTE}` : strip.footer}
    </p>
  )
}
