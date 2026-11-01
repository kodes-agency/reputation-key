import { QrCode, Star, Link2, Languages, Clock } from 'lucide-react'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import { CheckInSection } from '#/components/features/shared/check-in-section'
import { InlineLink } from '#/components/ui/inline-link'
import { portalResultsCheckIn } from './portal-results-check-in'
import { portalResultsQuietLines } from './portal-results-quiet-lines'
import { PortalResultsTrend } from './portal-results-trend'
import { PortalResultsLinks } from './portal-results-links'
import type { PortalResultsPlace } from './portal-results-place'
import { INBOX_WAITING_QUEUE } from '../portal-overview/portal-overview-inbox'

type CardsProps = Readonly<{ data: PortalAnalyticsData; place?: PortalResultsPlace }>

function Evidence({ lines }: Readonly<{ lines: readonly string[] }>) {
  return lines.map((line) => (
    <p key={line} className="py-2 text-sm text-muted-foreground">
      {line}
    </p>
  ))
}

function chartIsDrawn({ data, place }: CardsProps): boolean {
  const { value, evidence } = data.kpis.scans
  return (
    place?.scansCounted !== false &&
    value !== null &&
    value > 0 &&
    evidence.state === 'ready' &&
    data.series !== null
  )
}

function ScansEvidence({ data, place }: CardsProps) {
  const scans = data.kpis.scans.value
  return (
    <>
      {place && (place.scansCounted === false || scans === 0) ? (
        <InlineLink
          to="/properties/$propertyId/portals/$portalId"
          params={{ propertyId: place.propertyId, portalId: place.portalId }}
          search={{ tab: 'share' }}
        >
          See the code
        </InlineLink>
      ) : null}
      {data.series && chartIsDrawn({ data, place }) ? (
        <PortalResultsTrend
          key={`${data.localDays?.start}:${data.localDays?.end}`}
          series={data.series}
          markers={data.versionMarkers}
        />
      ) : null}
    </>
  )
}

function NotesEvidence({
  notes,
  place,
}: Readonly<{ notes: string | null; place?: PortalResultsPlace }>) {
  if (notes === null) return null
  return (
    <>
      <p className="py-2 text-sm text-muted-foreground">{notes}</p>
      {/* The Inbox has no filter per portal: open the Property’s private-notes queue. */}
      {place?.canOpenInbox ? (
        <InlineLink
          to="/inbox"
          search={{ propertyId: place.propertyId, queue: INBOX_WAITING_QUEUE }}
        >
          Read in inbox
        </InlineLink>
      ) : null}
    </>
  )
}

function QuietLines({ data, place }: CardsProps) {
  const quiet = portalResultsQuietLines(data, place?.scansCounted ?? true)
  const lines = [
    { Icon: QrCode, line: quiet.channel },
    { Icon: Languages, line: quiet.language },
    { Icon: Clock, line: quiet.busiest },
  ]
  return (
    <div className="space-y-2">
      {lines.map(({ Icon, line }) =>
        line ? (
          <p key={line} className="flex items-start gap-2 text-sm text-muted-foreground">
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {line}
          </p>
        ) : null,
      )}
    </div>
  )
}

export function PortalResultsCards({ data, place }: CardsProps) {
  const cards = portalResultsCheckIn(data, place)
  return (
    <>
      <CheckInSection
        title="Are guests using it?"
        icon={<QrCode aria-hidden="true" className="size-4" />}
        {...cards.using}
        hint={cards.using.hint ?? undefined}
      >
        <Evidence lines={cards.using.lines} />
        <ScansEvidence data={data} place={place} />
      </CheckInSection>
      <CheckInSection
        title="Are they happy?"
        icon={<Star aria-hidden="true" className="size-4" />}
        {...cards.happy}
        hint={cards.happy.hint ?? undefined}
      >
        <Evidence lines={cards.happy.lines} />
        <NotesEvidence notes={cards.notes ?? null} place={place} />
      </CheckInSection>
      <CheckInSection
        title="Are they going on to Google?"
        icon={<strong aria-hidden="true">G</strong>}
        {...cards.google}
        hint={cards.google.hint ?? undefined}
      >
        <Evidence lines={cards.google.lines} />
      </CheckInSection>
      {cards.links && data.linkTaps ? (
        <CheckInSection
          title="What else do they tap?"
          icon={<Link2 aria-hidden="true" className="size-4" />}
          {...cards.links}
          hint={cards.links.hint ?? undefined}
        >
          <PortalResultsLinks taps={data.linkTaps} place={place} />
        </CheckInSection>
      ) : null}
      <QuietLines data={data} place={place} />
    </>
  )
}
