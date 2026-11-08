import { GuestVoiceHowWeCount } from './guest-voice-how-we-count'
import { periodWords } from './guest-voice-check-in-words'
import { reviewsPhrase } from './guest-voice-words'
import { GuestVoiceRatingGoal } from './guest-voice-rating-goal'
import { RangeBusyRegion } from '#/components/features/dashboard/range-busy-region'
import { PageHeader } from '#/components/layout/page-header'
import { NAV_LABEL } from '#/components/layout/nav-labels'
import { trailCrumbs } from '#/components/layout/page-identity'
import { PageShell } from '#/components/layout/page-shell'
import { RangeControl } from '#/components/ui/range-control'
import type { GuestVoiceRange } from '#/shared/dashboard-range'
import { GuestVoiceV2Body, type GuestVoiceV2View } from './guest-voice-v2-body'
import { GUEST_VOICE_V2_RANGE_OPTIONS } from './property-guest-voice-ranges'
import { GuestVoiceState } from './property-guest-voice-state'

type Guest = Readonly<
  | { v2: GuestVoiceV2View; state?: undefined }
  | { state: 'disabled' | 'preparing'; v2?: undefined }
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

export function PropertyGuestVoicePage(props: Props) {
  const { propertyId, propertyName, range, onRangeChange, busy = false } = props
  const context = props.v2
    ? props.v2.read.status === 'ready'
      ? props.v2.read
      : props.v2.read.context
    : null
  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Guest voice"
        titleAside={
          props.v2 ? (
            <GuestVoiceHowWeCount read={props.v2.read} range={range} />
          ) : undefined
        }
        meta={
          props.v2 && (props.v2.googleNumbers?.shows != null || props.v2.ratingGoal)
            ? [
                <GuestVoiceRatingGoal
                  key="rating"
                  propertyId={propertyId}
                  goal={props.v2.ratingGoal}
                  google={props.v2.googleNumbers}
                />,
              ]
            : undefined
        }
        breadcrumbs={trailCrumbs(
          'property',
          { propertyId, propertyName },
          NAV_LABEL.guests,
        )}
        // A page that says why it has no figures yet has nothing to choose a window for.
        actions={
          props.state === undefined ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:flex-col md:items-start">
              <RangeControl
                value={range}
                onValueChange={onRangeChange}
                options={GUEST_VOICE_V2_RANGE_OPTIONS}
              />
              {context ? (
                <p className="text-sm text-muted-foreground">
                  {periodWords(context.window).replace(/^the /u, '').replace(/^l/u, 'L')}{' '}
                  · {reviewsPhrase(context.basis.textReviewCount)}
                </p>
              ) : null}
            </div>
          ) : undefined
        }
      />

      <RangeBusyRegion busy={busy}>
        {props.v2 !== undefined ? (
          <GuestVoiceV2Body propertyId={propertyId} view={props.v2} busy={busy} />
        ) : (
          <GuestVoiceState result={{ status: props.state }} propertyId={propertyId} />
        )}
      </RangeBusyRegion>
    </PageShell>
  )
}
