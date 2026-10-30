import { EyeOff } from 'lucide-react'
import { useRef } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { RegionError } from '#/components/ui/region-error'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import { Skeleton } from '#/components/ui/skeleton'
import type { IssueDrawer } from '#/contexts/ai/application/public-api'
import { GuestVoiceCauses } from './guest-voice-causes'
import { useGuestVoice } from './guest-voice-context'
import { GuestVoiceEvidence } from './guest-voice-evidence'
import { GuestVoiceIssueActions } from './guest-voice-issue-actions'
import { GuestVoiceIssueFacts } from './guest-voice-issue-facts'
import { GuestVoiceMonthBars } from './guest-voice-month-bars'
import { topicLabel } from './guest-voice-words'

/** What the drawer holds while it is open: being read, could not be read, or read. */
export type GuestVoiceDrawerRead =
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'error'; onRetry: () => void; retrying: boolean }>
  | Readonly<{ status: 'ready'; drawer: IssueDrawer }>

/** Everything under the header: the facts, the year, the causes, the guests' words, the actions. */
export function GuestVoiceIssueDetails({ drawer }: Readonly<{ drawer: IssueDrawer }>) {
  const { window } = useGuestVoice()
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 md:p-5">
      {drawer.hidden ? (
        <Alert variant="info">
          <EyeOff aria-hidden="true" />
          <AlertTitle>Hidden from the page</AlertTitle>
          <AlertDescription>
            <p>
              It is not ranked or counted on the page. Its reviews are still in the inbox.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      <GuestVoiceIssueFacts
        statistics={drawer.statistics}
        window={window}
        sense="complaint"
      />
      <GuestVoiceMonthBars series={drawer.twelveMonthSeries} />
      <GuestVoiceCauses causes={drawer.causes} label="Causes" />
      <GuestVoiceEvidence drawer={drawer} />
      <GuestVoiceIssueActions
        issueId={drawer.issueId}
        reviewCount={drawer.statistics.reviewCount}
      />
    </div>
  )
}

function DrawerPending() {
  return (
    <div
      role="status"
      aria-label="Reading the reviews behind this issue"
      className="flex flex-col gap-4 p-4 md:p-5"
    >
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

/**
 * The drawer of one issue: what it is, how it has gone over the year, what was wrong
 * and, in the guests' own words, read live from their reviews. It opens from a title
 * on the page; the page decides which issue and brings its answer.
 */
export function GuestVoiceIssueDrawer({
  openIssueId,
  knownTitle,
  read,
  onClose,
}: Readonly<{
  openIssueId: string | null
  /** The issue's name as the page already shows it, for while the drawer is being read. */
  knownTitle: string | null
  read: GuestVoiceDrawerRead
  onClose: () => void
}>) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const ready = read.status === 'ready' ? read.drawer : null
  const title = ready?.title ?? knownTitle ?? 'Issue details'
  return (
    <Sheet open={openIssueId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        // Focus lands on the name of what opened, not on the first control in it (an
        // explainer, or Try again), and a screen reader starts at the top.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleRef.current?.focus()
        }}
        className="flex w-full flex-col gap-0 overflow-hidden max-sm:border-l-0 sm:max-w-xl"
      >
        <SheetHeader className="gap-1 border-b p-4 pr-14 md:p-5 md:pr-16">
          <SheetTitle
            ref={titleRef}
            tabIndex={-1}
            className="text-lg tracking-tight outline-none"
          >
            {title}
          </SheetTitle>
          {ready !== null && ready.title !== topicLabel(ready.topic) ? (
            <p className="text-sm text-muted-foreground">{topicLabel(ready.topic)}</p>
          ) : null}
          <SheetDescription>
            {ready?.definition ?? 'The reviews behind one issue, read live.'}
          </SheetDescription>
        </SheetHeader>
        {read.status === 'pending' ? <DrawerPending /> : null}
        {read.status === 'error' ? (
          <div className="p-4 md:p-5">
            <RegionError
              size="compact"
              message="The reviews behind this issue couldn’t be loaded."
              onRetry={read.onRetry}
              retrying={read.retrying}
            />
          </div>
        ) : null}
        {ready === null ? null : <GuestVoiceIssueDetails drawer={ready} />}
      </SheetContent>
    </Sheet>
  )
}
