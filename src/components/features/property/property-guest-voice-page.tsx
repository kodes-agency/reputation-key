import { useQuery } from '@tanstack/react-query'
import { RangeBusyRegion } from '#/components/features/dashboard/range-busy-region'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import { PageHeader } from '#/components/layout/page-header'
import { NAV_LABEL } from '#/components/layout/nav-labels'
import { trailCrumbs } from '#/components/layout/page-identity'
import { PageShell } from '#/components/layout/page-shell'
import { RangeControl } from '#/components/ui/range-control'
import type { AiPropertyInsightsRead } from '#/contexts/ai/application/public-api'
import type { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import type { GuestVoiceRange } from '#/shared/dashboard-range'
import { aiKeys } from '#/shared/queries/query-keys'
import {
  GuestVoiceV2Body,
  type GuestVoiceV2View,
} from './guest-voice/guest-voice-v2-body'
import { PropertyGuestVoiceBasis } from './property-guest-voice-basis'
import {
  GUEST_VOICE_RANGE_OPTIONS,
  GUEST_VOICE_V2_RANGE_OPTIONS,
} from './property-guest-voice-ranges'
import { GuestVoiceState } from './property-guest-voice-state'
import { GuestVoiceTrend } from './property-guest-voice-trend'
import { PropertyInsightsTopicTable } from './property-insights-aspect-table'
import { PropertyInsightsRecurringIssues } from './property-insights-recurring-issues'

export type PropertyGuestVoiceServerFns = Readonly<{
  getTrend: typeof getPropertyAiTrendFn
}>

/**
 * Today's page reads the v2 analysis (`result`) and draws the topics and recurring
 * issues. Guest voice 2.0 (`v2`) reads the v3 analysis and draws the fix-first page;
 * a property is shown one or the other. Which is decided where the read model is, in a
 * later slice: until then the caller passes `v2`, or does not.
 */
type Guest = Readonly<
  | {
      result: AiPropertyInsightsRead
      serverFns: PropertyGuestVoiceServerFns
      v2?: undefined
    }
  | { v2: GuestVoiceV2View; result?: undefined; serverFns?: undefined }
>

type Props = Guest &
  Readonly<{
    propertyId: string
    propertyName: string
    range: GuestVoiceRange
    onRangeChange: (range: GuestVoiceRange) => void
    /** The next range is being read: the page shown is the previous range's, dimmed. */
    busy?: boolean
  }>

function GuestVoiceV1Body({
  propertyId,
  range,
  result,
  serverFns,
}: Readonly<{
  propertyId: string
  range: GuestVoiceRange
  result: AiPropertyInsightsRead
  serverFns: PropertyGuestVoiceServerFns
}>) {
  const trend = useQuery({
    queryKey: aiKeys.propertyTrend(propertyId),
    queryFn: () => serverFns.getTrend({ data: { propertyId } }),
    staleTime: 60_000,
    retry: false,
    enabled: result.status === 'ready',
  })

  if (result.status !== 'ready') {
    return <GuestVoiceState result={result} range={range} propertyId={propertyId} />
  }
  return (
    <div className="flex flex-col gap-6">
      <GuestVoiceTrend
        trend={trend.data}
        pending={trend.isPending}
        propertyId={propertyId}
      />
      <PropertyGuestVoiceBasis result={result} />
      <section aria-labelledby="guest-voice-topics" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="guest-voice-topics" className="text-lg font-semibold tracking-tight">
            <GlossaryTerm term="topics" />
          </h2>
          <p className="text-sm text-muted-foreground">
            One row per topic found in analysed review text, the one with the most stars
            at stake first.
          </p>
        </div>
        <PropertyInsightsTopicTable propertyId={propertyId} evidence={result} />
      </section>
      <section
        aria-labelledby="guest-voice-recurring-issues"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="guest-voice-recurring-issues"
            className="text-lg font-semibold tracking-tight"
          >
            <GlossaryTerm term="recurring-issues" />
          </h2>
          <p className="text-sm text-muted-foreground">
            Specific problems found in analysed review text and named in more than one
            review.
          </p>
        </div>
        <PropertyInsightsRecurringIssues evidence={result} />
      </section>
    </div>
  )
}

export function PropertyGuestVoicePage(props: Props) {
  const { propertyId, propertyName, range, onRangeChange, busy = false } = props
  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Guest voice"
        description="What guests praise, what needs attention, and how the picture is changing."
        breadcrumbs={trailCrumbs(
          'property',
          { propertyId, propertyName },
          NAV_LABEL.guests,
        )}
        actions={
          <RangeControl
            value={range}
            onValueChange={onRangeChange}
            options={
              props.v2 === undefined
                ? GUEST_VOICE_RANGE_OPTIONS
                : GUEST_VOICE_V2_RANGE_OPTIONS
            }
          />
        }
      />

      <RangeBusyRegion busy={busy}>
        {props.v2 === undefined ? (
          <GuestVoiceV1Body
            propertyId={propertyId}
            range={range}
            result={props.result}
            serverFns={props.serverFns}
          />
        ) : (
          <GuestVoiceV2Body propertyId={propertyId} range={range} view={props.v2} />
        )}
      </RangeBusyRegion>
    </PageShell>
  )
}
