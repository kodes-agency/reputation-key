// The questions on the Google rating goal's page (2026-11-01, ADR 0067): each is a
// check-in band, the question and its answer beside what shows it, as on Guest voice
// and Portal Results. The words are `rating-goal-bands-view.ts`'.
import { Link } from '@tanstack/react-router'
import {
  Clock,
  Flag,
  Inbox,
  MessageCircle,
  PartyPopper,
  Pencil,
  QrCode,
  Sprout,
  Star,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { CheckInSection } from '#/components/features/shared/check-in-section'
import { InlineLink } from '#/components/ui/inline-link'
import { formatLocalDate } from '#/lib/format'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  GOAL_ACTION_LINK,
  GoalActionButton,
  GoalActionRows,
  GoalActionWords,
} from './goal-action-row'
import { GoalColumns } from './goal-columns'
import {
  keepBand,
  risingBand,
  todoBand,
  type BandContext,
  type BandIcon,
  type BandWords,
} from './rating-goal-bands-view'
import { ASK_EVERY_GUEST_ROW } from './rating-goal-copy'
import { RatingGoalLineChart } from './rating-goal-line-chart'
import { lineChartModel } from './rating-goal-line-chart-view'
import { thisWeekText } from './rating-goal-moved-view'
import {
  lowFact,
  lowReviewRow,
  newestLowReview,
  reviewsBand,
  starsFact,
  weekBars,
} from './rating-goal-review-facts-view'

const ICONS = {
  up: TrendingUp,
  down: TrendingDown,
  new: Sprout,
  wait: Clock,
  reviews: MessageCircle,
  flag: Flag,
  done: PartyPopper,
} as const satisfies Readonly<Record<BandIcon, unknown>>

function Band({
  words,
  children,
}: Readonly<{ words: BandWords; children: React.ReactNode }>) {
  const Icon = ICONS[words.icon]
  return (
    <CheckInSection
      title={words.title}
      icon={<Icon aria-hidden="true" className="size-4" />}
      answer={words.answer}
      hint={words.hint ?? undefined}
      tone={words.tone}
    >
      {children}
    </CheckInSection>
  )
}

const ROW_ICON = 'size-5'
const FACT_ICON = 'mt-0.5 size-4 shrink-0 text-muted-foreground'

type Props = BandContext &
  Readonly<{
    detail: RatingGoalDetailView
    propertyId: string
    /** Opens the change of plan; none where this viewer may not change it. */
    onChangePlan?: () => void
  }>

/** Under the bars: what the new reviews average, and how many were low, with the way to read them. */
function Facts({ detail, propertyId }: Pick<Props, 'detail' | 'propertyId'>) {
  const stars = starsFact(detail)
  const low = lowFact(detail)
  const newest = newestLowReview(detail)
  if (stars === null && low === null) return null
  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t pt-2.5 pb-1 text-sm">
      {stars === null ? null : (
        <p className="flex gap-2">
          <Star aria-hidden="true" className={FACT_ICON} />
          <span>{stars}</span>
        </p>
      )}
      {low === null ? null : (
        <p className="flex gap-2">
          <Flag aria-hidden="true" className={FACT_ICON} />
          <span>
            {low}{' '}
            {newest?.inboxItemId ? (
              <InlineLink
                underline="always"
                to="/properties/$propertyId/reviews"
                params={{ propertyId }}
                search={{ itemId: newest.inboxItemId }}
              >
                Open in the inbox
              </InlineLink>
            ) : null}
          </span>
        </p>
      )}
    </div>
  )
}

function ReviewsBand({ detail, propertyId }: Pick<Props, 'detail' | 'propertyId'>) {
  const bars = weekBars(detail, (key) => formatLocalDate(key, { year: false }) ?? key)
  return (
    <Band words={reviewsBand(detail)}>
      {bars === null ? null : (
        <GoalColumns
          caption="New reviews each week"
          columns={bars.columns}
          plan={bars.plan}
          label="New reviews each week; use left and right arrows to read each week."
          hint="Hover or tap a bar to read that week."
        />
      )}
      <Facts detail={detail} propertyId={propertyId} />
    </Band>
  )
}

/** The rows of what to do: each only where it applies and this viewer may follow it. */
function TodoRows({ detail, propertyId, timezone, now, onChangePlan }: Props) {
  const { can } = usePermissions()
  const low = newestLowReview(detail)
  const tooLow = detail.status === 'reviews_too_low'
  return (
    <GoalActionRows>
      {tooLow ? (
        <Link
          className={GOAL_ACTION_LINK}
          to="/properties/$propertyId/guests"
          params={{ propertyId }}
        >
          <GoalActionWords
            icon={<MessageCircle className={ROW_ICON} />}
            title="See what to fix first"
            note="Guest voice shows what guests complain about most."
          />
        </Link>
      ) : null}
      {low?.inboxItemId ? (
        <Link
          className={GOAL_ACTION_LINK}
          to="/properties/$propertyId/reviews"
          params={{ propertyId }}
          search={{ itemId: low.inboxItemId }}
        >
          <GoalActionWords
            icon={<Inbox className={ROW_ICON} />}
            {...lowReviewRow(low, { timezone, now })}
          />
        </Link>
      ) : null}
      {!tooLow && can('portal.read') ? (
        <Link
          className={GOAL_ACTION_LINK}
          to="/properties/$propertyId/portals"
          params={{ propertyId }}
        >
          <GoalActionWords
            icon={<QrCode className={ROW_ICON} />}
            title={ASK_EVERY_GUEST_ROW.title}
            note={ASK_EVERY_GUEST_ROW.note}
          />
        </Link>
      ) : null}
      {detail.status === 'below_pace' && onChangePlan !== undefined ? (
        <GoalActionButton
          icon={<Pencil className={ROW_ICON} />}
          title="Change the plan"
          note="If this pace is too much right now, a slower one still gets there."
          onClick={onChangePlan}
        />
      ) : null}
    </GoalActionRows>
  )
}

function NextGoalRow({ propertyId }: Pick<Props, 'propertyId'>) {
  return (
    <GoalActionRows>
      <Link
        className={GOAL_ACTION_LINK}
        to="/properties/$propertyId/goals"
        params={{ propertyId }}
      >
        <GoalActionWords
          icon={<Target className={ROW_ICON} />}
          title="Go to your goals"
          note="Set the next number from there."
        />
      </Link>
    </GoalActionRows>
  )
}

/** The climb's three questions; a goal found ended stops after how it went. */
export function RatingGoalBands(props: Props) {
  const { detail, timezone, now, propertyId } = props
  const model = lineChartModel(detail)
  return (
    <>
      <Band words={risingBand(detail, { timezone, now })}>
        {model === null ? null : <RatingGoalLineChart model={model} />}
      </Band>
      {detail.state === 'ended' ? null : (
        <ReviewsBand detail={detail} propertyId={propertyId} />
      )}
      <Band words={todoBand(detail)}>
        {detail.state === 'active' ? (
          <TodoRows {...props} />
        ) : (
          <NextGoalRow propertyId={propertyId} />
        )}
      </Band>
    </>
  )
}

/** A goal to keep a number has no climb: one question, and this week's reviews. */
export function RatingGoalKeepBand({
  detail,
  timezone,
  now,
}: Pick<Props, 'detail' | 'timezone' | 'now'>) {
  return (
    <Band words={keepBand(detail, { timezone, now })}>
      <p className="py-2 text-sm">
        <span className="text-muted-foreground">This week: </span>
        {thisWeekText(detail.moved.thisWeek)}
      </p>
    </Band>
  )
}
