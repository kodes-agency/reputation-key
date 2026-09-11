// Dashboard → Overview (redesign rows 4, 5, 8, 12).
//
// Four rows, one laptop screen, no charts: is anything wrong, how are we doing,
// what are guests saying, what's new. Replaces a 4,161 px page that carried
// three time windows, a 612 px histogram, a card of three zeros, and four of
// its first six numbers as dashes.
//
// There is no range control. Each tile shows the number a manager recognises
// (identity, all-time) beside the recent movement (pulse, last 30 days against
// the 30 before) in a fixed role per tile — so a property with an old review
// history can no longer read `REVIEWS 3 · AVG RATING 2.3` next to `252 items to
// triage` just because a 30-day default was in force.
import { Link } from '@tanstack/react-router'
import type {
  AttentionSignals,
  DashboardData,
} from '#/contexts/reporting/application/public-api'
import { Button } from '#/components/ui/button'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { AttentionBand } from './attention-band'
import { OverviewTile, PulseDelta } from './overview-tile'
import {
  OverviewGuestVoice,
  type OverviewGuestVoiceServerFns,
} from './overview-guest-voice'
import { ReviewRow } from './property-dashboard-review-row'
import {
  OverviewProfileViews,
  type OverviewProfileViewsServerFns,
} from './overview-profile-views'

/** The ten-ratings-per-period rule the read model already enforces. */
const MIN_RATING_COMPARISON_SAMPLE = 10

export interface PropertyOverviewProps {
  property: Readonly<{ id: string; name: string }> | null | undefined
  propertyId: string
  /** All-time read: the numbers a manager recognises. */
  lifetime: DashboardData
  /** Last 30 days against the 30 before: the pulse. */
  pulse: DashboardData
  signals: AttentionSignals
  guestVoiceFns: OverviewGuestVoiceServerFns
  profileViewsFns: OverviewProfileViewsServerFns
}

function ratingTile(lifetime: DashboardData, pulse: DashboardData, propertyId: string) {
  const allTime = lifetime.kpis.avgRating
  const recent = pulse.kpis.avgRating

  // Identity leads: this is the number on the Google profile.
  const value = allTime.value === null ? null : allTime.value.toFixed(1)

  let context: React.ReactNode
  if (allTime.value === null) {
    context = 'No ratings yet.'
  } else if (recent.value === null) {
    context = `From ${allTime.sampleCount.toLocaleString()} ratings · none in the last 30 days`
  } else if (
    recent.comparison !== null &&
    recent.sampleCount >= MIN_RATING_COMPARISON_SAMPLE
  ) {
    const up = recent.comparison > 0
    const same = recent.comparison === 0
    context = (
      <>
        {recent.value.toFixed(1)} over the last 30 days ·{' '}
        {same ? (
          'unchanged'
        ) : (
          <span className={up ? 'text-positive' : 'text-destructive'}>
            {up ? '↑' : '↓'} {Math.abs(recent.comparison).toFixed(1)} vs the 30 before
          </span>
        )}
      </>
    )
  } else {
    // Below the sample rule there is no delta to show, so say what there is.
    context = `${recent.sampleCount.toLocaleString()} new ${
      recent.sampleCount === 1 ? 'rating' : 'ratings'
    } in the last 30 days`
  }

  return (
    <OverviewTile
      label="Rating"
      value={value === null ? null : `${value} ★`}
      context={context}
      link={{ to: '/properties/$propertyId/ratings', params: { propertyId } }}
      linkLabel="Rating — open Ratings"
    />
  )
}

function reviewsTile(lifetime: DashboardData, pulse: DashboardData, propertyId: string) {
  // Pulse leads here: the all-time count is trivia, the recent count is news.
  const recent = pulse.kpis.reviews.value
  const allTime = lifetime.kpis.reviews.value

  return (
    <OverviewTile
      label="Reviews"
      value={recent === 0 ? null : recent.toLocaleString()}
      context={
        recent === 0 ? (
          allTime === 0 ? (
            'No reviews yet.'
          ) : (
            `None in the last 30 days · ${allTime.toLocaleString()} all time`
          )
        ) : (
          <>
            in the last 30 days ·{' '}
            <PulseDelta percent={pulse.kpis.reviews.trend} suffix="vs the 30 before" />
            {pulse.kpis.reviews.trend === null
              ? `${allTime.toLocaleString()} all time`
              : null}
          </>
        )
      }
      link={{ to: '/properties/$propertyId/ratings', params: { propertyId } }}
      linkLabel="Reviews — open Ratings"
    />
  )
}

function replyTile(pulse: DashboardData, propertyId: string) {
  const { replyRate, avgReplyHours } = pulse.replyPerformance
  const hadReviews = pulse.kpis.reviews.value > 0

  return (
    <OverviewTile
      label="Reply rate"
      value={hadReviews ? `${replyRate}%` : null}
      context={
        !hadReviews
          ? 'No reviews needed a reply in the last 30 days.'
          : avgReplyHours === null
            ? 'in the last 30 days · nothing replied to yet'
            : `in the last 30 days · typically within ${formatReplyTime(avgReplyHours)}`
      }
      link={{ to: '/properties/$propertyId/ratings', params: { propertyId } }}
      linkLabel="Reply rate — open Ratings"
    />
  )
}

function formatReplyTime(hours: number): string {
  if (hours < 1) return 'the hour'
  if (hours < 24) return `${Math.round(hours)}h`
  const days = hours / 24
  return `${days < 10 ? days.toFixed(1) : Math.round(days)} days`
}

export function PropertyOverview({
  property,
  propertyId,
  lifetime,
  pulse,
  signals,
  guestVoiceFns,
  profileViewsFns,
}: PropertyOverviewProps) {
  if (!property) return null

  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Overview"
        description={property.name}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: property.name },
          { label: 'Overview' },
        ]}
      />

      <AttentionBand signals={signals} propertyId={propertyId} />

      <section aria-labelledby="overview-scorecard" className="space-y-3">
        <h2 id="overview-scorecard" className="text-lg font-semibold tracking-tight">
          How you are doing
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {ratingTile(lifetime, pulse, propertyId)}
          {reviewsTile(lifetime, pulse, propertyId)}
          {replyTile(pulse, propertyId)}
          <OverviewProfileViews propertyId={propertyId} serverFns={profileViewsFns} />
        </div>
        <p className="text-sm text-muted-foreground">
          Last 30 days against the 30 before · rating is all-time.
        </p>
      </section>

      <OverviewGuestVoice propertyId={propertyId} serverFns={guestVoiceFns} />

      <section aria-labelledby="overview-recent" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="overview-recent" className="text-lg font-semibold tracking-tight">
            Latest reviews
          </h2>
          <Button variant="outline" size="sm" asChild>
            <Link to="/inbox" search={{ propertyId }}>
              All reviews
            </Link>
          </Button>
        </div>
        {lifetime.recentReviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reviews yet. They appear here as soon as Google sends them.
          </p>
        ) : (
          <div className="space-y-2">
            {lifetime.recentReviews.map((review) => (
              <ReviewRow key={review.id} review={review} propertyId={propertyId} />
            ))}
          </div>
        )}
      </section>
    </PageShell>
  )
}

export type { OverviewGuestVoiceServerFns, OverviewProfileViewsServerFns }
