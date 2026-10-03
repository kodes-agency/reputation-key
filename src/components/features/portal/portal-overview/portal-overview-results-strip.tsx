// The Portals overview's results strip (boards 01, 10 and 11): the window the
// figures cover and its five measures over every Portal of the Property (or, on
// the All properties page, of the whole Organization), in the same ruled strip a
// single Portal's Results tab prints. The range is a viewing
// preference that follows the reader from the Results tab (All Time is not
// offered: a lifetime figure comes from the lifetime aggregate, not from readings).
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { RegionError } from '#/components/ui/region-error'
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
import {
  PortalResultsLoadingStrip,
  PortalResultsStrip,
} from '../portal-analytics/portal-results-strip'
import { PORTAL_OVERVIEW_RANGES } from '../portal-analytics/portal-results-window'
import { INBOX_WAITING_QUEUE, inboxWaitingLabel } from './portal-overview-inbox'
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
  /**
   * Property scope only: how many private notes from its Portals wait in the
   * Inbox, linked under the Private notes figure. Null or zero leaves the link
   * out; the Organization's and a group's strips never carry it.
   */
  inboxWaiting?: number | null
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

/**
 * "3 waiting in Inbox →", the Private notes cell's detail line, into the Inbox's
 * private feedback queue for the Property. The accent link colour and the cell
 * detail's size are the boards'; the padding only grows the touch target.
 */
function InboxWaitingLink({
  propertyId,
  label,
}: Readonly<{ propertyId: string; label: string }>) {
  return (
    <Link
      to="/inbox"
      search={{ propertyId, queue: INBOX_WAITING_QUEUE }}
      className={cn(
        '-my-1.5 inline-flex items-center gap-1 rounded-sm py-1.5 text-xs leading-4 font-medium',
        'underline-offset-4 hover:underline',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
      )}
    >
      {label}
      <ArrowRight className="size-3" aria-hidden="true" />
    </Link>
  )
}

export function PortalOverviewResultsStrip({
  controls,
  propertyId,
  propertiesListed,
  groupId,
  inboxWaiting = null,
}: Props) {
  const { state, timeRange, onTimeRangeChange, onRetry, busy = false } = controls
  if (state.status === 'off') return null
  const strip = stripOf(state, propertyId, groupId)
  const waitingLabel =
    propertyId !== null && groupId === undefined ? inboxWaitingLabel(inboxWaiting) : null
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
      {state.status === 'loading' ? <PortalResultsLoadingStrip /> : null}
      {state.status === 'failed' ? (
        <RegionError
          size="compact"
          message="Results couldn’t be loaded."
          description="The portals below are unaffected."
          onRetry={onRetry}
        />
      ) : null}
      {strip ? (
        <div className={cn('transition-opacity', busy && 'opacity-60')} aria-busy={busy}>
          <PortalResultsStrip
            cells={strip.cells}
            notesDetail={
              propertyId !== null && waitingLabel !== null ? (
                <InboxWaitingLink propertyId={propertyId} label={waitingLabel} />
              ) : undefined
            }
          />
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
