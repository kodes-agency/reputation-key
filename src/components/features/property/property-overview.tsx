import type { ReactNode } from 'react'
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
import { useState } from 'react'
import type {
  AttentionSignals,
  DashboardData,
  GoogleNumbersView,
} from '#/contexts/reporting/application/public-api'
import { Button } from '#/components/ui/button'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { NAV_LABEL } from '#/components/layout/nav-labels'
import { trailCrumbs } from '#/components/layout/page-identity'
import { AttentionBand } from './attention-band'
import { OverviewTile, PULSE_COMPARISON_LABEL, TileCaption } from './overview-tile'
import {
  OverviewGuestVoice,
  type OverviewGuestVoiceServerFns,
} from './overview-guest-voice'
import { ReviewRow } from './property-dashboard-review-row'
import {
  OverviewProfileViews,
  type OverviewProfileViewsServerFns,
} from './overview-profile-views'
import { formatNumber, formatShortDate } from '#/lib/format'
import { MetricDelta } from '#/components/ui/metric-delta'
import { RatingFigure } from '#/components/ui/rating-figure'

export interface PropertyOverviewProps {
  /** The Property's zone: Google's date is on its clock. */
  property: Readonly<{ id: string; name: string; timezone: string }>
  propertyId: string
  /** All-time read: the numbers a manager recognises. */
  lifetime: DashboardData
  /** Last 30 days against the 30 before: the pulse. */
  pulse: DashboardData
  /**
   * Google's own rating and review count (decision 16): the Rating tile leads
   * with it. Null when Google never sent numbers for the current binding.
   */
  google: GoogleNumbersView | null
  signals: AttentionSignals
  /** Portals guests cannot use, for the attention band's one portal chip; left out: no chip. */
  blockedPortals?: number
  guestVoiceFns: OverviewGuestVoiceServerFns
  profileViewsFns: OverviewProfileViewsServerFns
  /** What is left to set the property up; renders nothing once it is done. */
  setupStrip?: ReactNode
  /**
   * The Google rating goal: its simple card, its news, or one line into its
   * wizard; between the attention band and "How you are doing".
   */
  ratingGoal?: ReactNode
}

/** "812 reviews on Google", and Google's date while its numbers are not current. */
function googleCaption(
  google: GoogleNumbersView,
  timezone: string,
  now: Date,
): React.ReactNode {
  const count = `${formatNumber(google.reviewCount)} ${
    google.reviewCount === 1 ? 'review' : 'reviews'
  } on Google`
  const asOf = google.current ? null : formatShortDate(google.asOf, timezone, now)
  return asOf === null ? count : <TileCaption caption={count} detail={`as of ${asOf}`} />
}

/**
 * Google's own number and count lead (decision 16), never RepKey's average of
 * the reviews it holds. Numbers more than a day old, or read while Google is not
 * linked, are Google's last ones and keep their date; a Property Google never
 * sent numbers for says so. The Ratings page keeps RepKey's period averages.
 */
function ratingTile(
  google: GoogleNumbersView | null,
  propertyId: string,
  timezone: string,
  now: Date,
) {
  let context: React.ReactNode
  if (google === null) {
    context = 'Google hasn’t sent this property’s rating yet.'
  } else if (google.shows === null) {
    context = 'No Google reviews yet.'
  } else {
    context = googleCaption(google, timezone, now)
  }

  return (
    <OverviewTile
      label="Rating"
      value={
        google?.shows == null ? null : <RatingFigure value={google.shows} size="lg" />
      }
      context={context}
      link={{ to: '/properties/$propertyId/ratings', params: { propertyId } }}
      linkLabel="Rating — open Ratings"
    />
  )
}

function reviewsTile(
  lifetime: DashboardData,
  pulse: DashboardData,
  google: GoogleNumbersView | null,
  propertyId: string,
) {
  // Pulse leads here: the all-time count is trivia, the recent count is news.
  // The all-time count is Google's own where Google sent one, as the Rating
  // tile's is, so the two tiles never name two totals.
  const recent = pulse.kpis.reviews.value
  const allTime = google?.reviewCount ?? lifetime.kpis.reviews.value

  return (
    <OverviewTile
      label="Reviews"
      value={recent === 0 ? null : formatNumber(recent)}
      context={
        recent === 0 ? (
          allTime === 0 ? (
            'No reviews yet.'
          ) : (
            `None in the last 30 days · ${formatNumber(allTime)} all time`
          )
        ) : (
          <TileCaption
            caption="in the last 30 days"
            detail={
              pulse.kpis.reviews.trend === null ? (
                `${formatNumber(allTime)} all time`
              ) : (
                <MetricDelta
                  value={pulse.kpis.reviews.trend}
                  unit="percent"
                  fractionDigits={0}
                  comparisonLabel={PULSE_COMPARISON_LABEL}
                />
              )
            }
          />
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
  google,
  signals,
  blockedPortals,
  guestVoiceFns,
  profileViewsFns,
  setupStrip,
  ratingGoal,
}: PropertyOverviewProps) {
  const [now] = useState(() => new Date())
  const { timezone } = property
  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Overview"
        meta={[property.name]}
        breadcrumbs={trailCrumbs(
          'property',
          { propertyId, propertyName: property.name },
          NAV_LABEL.overview,
        )}
      />

      {setupStrip}

      <AttentionBand
        signals={signals}
        propertyId={propertyId}
        blockedPortals={blockedPortals}
      />

      {ratingGoal}

      <section aria-labelledby="overview-scorecard" className="space-y-3">
        <h2 id="overview-scorecard" className="text-lg font-semibold tracking-tight">
          How you are doing
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ratingTile(google, propertyId, timezone, now)}
          {reviewsTile(lifetime, pulse, google, propertyId)}
          {replyTile(pulse, propertyId)}
          <OverviewProfileViews propertyId={propertyId} serverFns={profileViewsFns} />
        </div>
        <p className="text-sm text-muted-foreground">
          Last 30 days against the 30 before · the rating is Google’s own.
        </p>
      </section>

      <OverviewGuestVoice propertyId={propertyId} serverFns={guestVoiceFns} />

      <section aria-labelledby="overview-recent" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="overview-recent" className="text-lg font-semibold tracking-tight">
            Latest reviews
          </h2>
          <Button variant="outline" asChild>
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
