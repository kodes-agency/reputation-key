import type {
  GuestVoiceV2Ready,
  GuestVoiceV2Read,
} from '#/contexts/ai/application/public-api'
import type { GuestVoiceRange } from '#/shared/dashboard-range'
import { GuestVoiceBasis } from './guest-voice-basis'
import { GuestVoiceProvider } from './guest-voice-context'
import { GuestVoiceEveryTopic } from './guest-voice-every-topic'
import { GuestVoiceFixFirst } from './guest-voice-fix-first'
import { GuestVoiceGuestsLove } from './guest-voice-guests-love'
import { GuestVoiceInShort } from './guest-voice-in-short'
import {
  GuestVoiceIssueDrawer,
  type GuestVoiceDrawerRead,
} from './guest-voice-issue-drawer'
import { GuestVoiceNotEnough } from './guest-voice-not-enough'
import { GuestVoiceRatingGoal } from './guest-voice-rating-goal'
import type { GuestVoiceGoalFacts } from './guest-voice-rating-goal-words'
import { GuestVoiceUrgent } from './guest-voice-urgent'
import { GuestVoiceWatch } from './guest-voice-watch'
import { GuestVoiceWhatChanged } from './guest-voice-what-changed'

/** An issue's drawer: which issue is open, how to open or close one, and what it holds. */
type GuestVoiceDrawerView = Readonly<{
  /** The issue whose drawer is open, or null. Kept in the address by the route. */
  openIssueId: string | null
  onOpenIssueChange: (issueId: string | null) => void
  /** What the open drawer holds. */
  read: GuestVoiceDrawerRead
}>

/**
 * What the page needs of the world to draw Guest voice 2.0: the read, the drawer of an
 * issue, and what "Not right?" does. The route owns all of it; the page only draws.
 */
export type GuestVoiceV2View = Readonly<{
  read: GuestVoiceV2Read
  /**
   * Absent while the drawer has no read behind it. Then no issue's name is a button and
   * no drawer is drawn: the page offers no door to an empty drawer.
   */
  drawer?: GuestVoiceDrawerView
  /** The manager says an issue is wrong. Absent: "Not right?" is not drawn. */
  onNotRight?: (issueId: string) => void
  /**
   * Where the Property's Google rating goal stands, to name it beside the top problem.
   * Absent or null: the Property has no active goal, or the reader cannot read it, and
   * the page draws nothing of it.
   */
  ratingGoal?: GuestVoiceGoalFacts | null
}>

/** The name of an issue the page shows, wherever it shows it. */
function titleOf(read: GuestVoiceV2Ready, issueId: string | null): string | null {
  if (issueId === null) return null
  const shown = [
    ...read.urgent,
    ...read.fixFirst,
    ...read.guestsLove,
    ...read.watch,
    ...read.whatChanged,
  ].find((issue) => issue.issueId === issueId)
  return shown?.title ?? null
}

/**
 * The body of Guest voice 2.0, in the order a manager reads it: anything urgent, the
 * window, the page in three lines, what to fix first, what to watch, what guests love,
 * what changed, and every topic. A property with too few reviews gets the latest ones
 * instead, and says why.
 */
export function GuestVoiceV2Body({
  propertyId,
  range,
  view,
}: Readonly<{ propertyId: string; range: GuestVoiceRange; view: GuestVoiceV2View }>) {
  const { read, drawer, onNotRight, ratingGoal } = view
  if (read.status === 'not_enough_reviews') {
    return <GuestVoiceNotEnough read={read} propertyId={propertyId} />
  }
  return (
    <GuestVoiceProvider
      value={{
        propertyId,
        window: read.window,
        startLocalDate: read.startLocalDate,
        endLocalDate: read.endLocalDate,
        onOpenIssue: drawer?.onOpenIssueChange,
        onNotRight,
      }}
    >
      {/* The container the sections lay themselves out by, as a table does: the room
          the page has, not the window, so an open sidebar counts. */}
      <div className="@container flex flex-col gap-6 md:gap-8">
        <GuestVoiceUrgent items={read.urgent} otherCount={read.urgentOtherCount ?? 0} />
        <GuestVoiceBasis read={read} range={range} />
        <GuestVoiceInShort lines={read.inShort} />
        <GuestVoiceFixFirst items={read.fixFirst} />
        <GuestVoiceRatingGoal goal={ratingGoal} top={read.fixFirst.at(0)} />
        <GuestVoiceWatch items={read.watch} />
        <GuestVoiceGuestsLove items={read.guestsLove} staffPraise={read.staffPraise} />
        <GuestVoiceWhatChanged items={read.whatChanged} provisional={read.provisional} />
        <GuestVoiceEveryTopic rows={read.everyTopic} />
      </div>
      {drawer === undefined ? null : (
        <GuestVoiceIssueDrawer
          openIssueId={drawer.openIssueId}
          knownTitle={titleOf(read, drawer.openIssueId)}
          read={drawer.read}
          onClose={() => drawer.onOpenIssueChange(null)}
        />
      )}
    </GuestVoiceProvider>
  )
}
