import { lazy, Suspense } from 'react'
import type {
  GuestVoiceDetailTarget,
  GuestVoiceV2Read,
} from '#/contexts/ai/application/public-api'
import type { GoogleNumbersView } from '#/contexts/reporting/application/public-api'
import { windowDates } from './guest-voice-words'
import { GuestVoiceProvider } from './guest-voice-context'
import { GuestVoiceEveryTopic } from './guest-voice-every-topic'
import { GuestVoiceFixFirst } from './guest-voice-fix-first'
import { GuestVoiceGuestsLove } from './guest-voice-guests-love'
import type { GuestVoiceDrawerRead } from './guest-voice-issue-drawer'
import { GuestVoiceNotEnough } from './guest-voice-not-enough'
import type { GuestVoiceGoalFacts } from './guest-voice-rating-goal-words'
import { GuestVoiceUrgent } from './guest-voice-urgent'
import { GuestVoiceRatingTrend } from './guest-voice-rating-trend'
import type { GuestVoiceDetailNavigation } from './use-guest-voice-detail-navigation'

const DetailSheet = lazy(() =>
  import('./guest-voice-issue-drawer').then((module) => ({
    default: module.GuestVoiceIssueDrawer,
  })),
)
export type GuestVoiceV2View = Readonly<{
  read: GuestVoiceV2Read
  drawer?: Readonly<{
    target: GuestVoiceDetailTarget | null
    onTargetChange: (target: GuestVoiceDetailTarget | null) => void
    read: GuestVoiceDrawerRead
    navigation?: GuestVoiceDetailNavigation
  }>
  ratingGoal?: GuestVoiceGoalFacts | null
  googleNumbers?: GoogleNumbersView | null
}>

export function GuestVoiceV2Body({
  propertyId,
  view,
  busy = false,
}: Readonly<{
  propertyId: string
  view: GuestVoiceV2View
  busy?: boolean
}>) {
  const { read, drawer } = view
  const context = read.status === 'ready' ? read : read.context
  return (
    <GuestVoiceProvider
      value={{
        propertyId,
        window: context.window,
        startLocalDate: context.startLocalDate,
        endLocalDate: context.endLocalDate,
        onOpenDetail: busy || !drawer ? undefined : drawer.onTargetChange,
      }}
    >
      <div className="@container flex flex-col gap-4 md:gap-6" aria-busy={busy}>
        {busy ? (
          <p role="status" className="text-sm text-muted-foreground">
            Updating this period. Figures shown cover{' '}
            {windowDates(context.startLocalDate, context.endLocalDate)}.
          </p>
        ) : null}
        <GuestVoiceUrgent concerns={read.seriousConcerns} />
        {read.status === 'not_enough_reviews' ? (
          <GuestVoiceNotEnough read={read} propertyId={propertyId} />
        ) : (
          <>
            <GuestVoiceRatingTrend
              key={`${context.startLocalDate}:${context.endLocalDate}`}
              trend={read.ratingTrend}
            />
            <div inert={busy || undefined}>
              <GuestVoiceFixFirst read={read} />
            </div>
            <div inert={busy || undefined}>
              <GuestVoiceGuestsLove read={read} />
            </div>
            <GuestVoiceEveryTopic rows={read.everyTopic} />
          </>
        )}
      </div>
      {drawer?.target ? (
        <Suspense fallback={null}>
          <DetailSheet
            target={drawer.target}
            knownTitle={
              read.seriousConcerns.items.find(
                (item) =>
                  drawer.target?.kind === 'concern' &&
                  item.issueId === drawer.target.issueId &&
                  item.urgentReason === drawer.target.reason,
              )?.title ??
              (read.status === 'ready' && drawer.target.kind === 'issue'
                ? (drawer.target.sense === 'praise'
                    ? read.guestsLove
                    : [...read.fixFirst, ...read.watch]
                  ).find(
                    (item) =>
                      item.issueId ===
                      (drawer.target?.kind === 'issue' ? drawer.target.issueId : null),
                  )?.title
                : undefined)
            }
            read={drawer.read}
            onClose={() => drawer.onTargetChange(null)}
            navigation={drawer.navigation}
          />
        </Suspense>
      ) : null}
    </GuestVoiceProvider>
  )
}
