import { useEffect, useEffectEvent, useRef } from 'react'
import { BackButton } from '#/components/ui/back-link'
import { RegionError } from '#/components/ui/region-error'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
} from '#/components/ui/sheet'
import {
  RESPONSIVE_DETAIL_SHEET,
  SheetDetailTitle as SheetTitle,
} from '#/components/ui/sheet-layouts'
import { ReadableBadge } from '#/components/ui/readable-badge'
import { Skeleton } from '#/components/ui/skeleton'
import type {
  GuestVoiceDetailRead,
  GuestVoiceDetailTarget,
} from '#/contexts/ai/application/public-api'
import { GuestVoiceIssueDetails } from './guest-voice-issue-details'
import { GuestVoiceConcernDetails } from './guest-voice-concern-details'
import { GuestVoiceTopicDetails } from './guest-voice-topic-details'
import { GuestVoiceIssueActions } from './guest-voice-issue-actions'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { GuestVoiceTopicIcon } from './guest-voice-topic-icon'
import { topicLabel } from './guest-voice-words'
import type { GuestVoiceDetailNavigation } from './use-guest-voice-detail-navigation'

export type GuestVoiceDrawerRead =
  | GuestVoiceDetailRead
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'error'; onRetry: () => void; retrying: boolean }>
export function GuestVoiceIssueDrawer({
  target,
  read,
  onClose,
  navigation,
  knownTitle,
}: Readonly<{
  target: GuestVoiceDetailTarget
  read: GuestVoiceDrawerRead
  onClose: () => void
  navigation?: GuestVoiceDetailNavigation
  knownTitle?: string
}>) {
  const { can } = usePermissions()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const ready = read.status === 'ready' ? read.drawer : null
  const title = ready
    ? ready.kind === 'topic'
      ? topicLabel(ready.topic)
      : ready.title
    : target.kind === 'topic'
      ? topicLabel(target.topic)
      : (knownTitle ?? navigation?.knownTitle() ?? 'Review details')
  const restoreDetail = useEffectEvent(() => navigation?.ready(title))
  useEffect(() => {
    if (!ready) return
    restoreDetail()
    titleRef.current?.focus({ preventScroll: true })
  }, [ready, title])
  const back = navigation?.backLabel()
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <SheetContent
        layout={RESPONSIVE_DETAIL_SHEET}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          if (navigation) {
            event.preventDefault()
            navigation.restorePage()
          }
        }}
      >
        <SheetHeader className="shrink-0 border-b pr-14">
          {back ? (
            <BackButton
              label={`Back to ${back}`}
              onClick={navigation?.back}
              className="self-start"
            />
          ) : null}
          {ready && ready.kind !== 'concern' ? (
            <ReadableBadge variant="neutral">
              <GuestVoiceTopicIcon topic={ready.topic} />
              {topicLabel(ready.topic)}
            </ReadableBadge>
          ) : null}
          <SheetTitle ref={titleRef} tabIndex={-1}>
            {title}
          </SheetTitle>
          <SheetDescription>
            {ready?.kind === 'issue'
              ? 'Counts and evidence from this period'
              : ready?.kind === 'concern'
                ? 'Serious concern reported by guests'
                : 'Counts and evidence from this period'}
          </SheetDescription>
        </SheetHeader>
        <div
          data-slot="guest-voice-detail-body"
          ref={navigation?.scrollRef}
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 md:p-5"
        >
          {read.status === 'pending' ? (
            <div
              role="status"
              aria-label="Reading review details"
              className="flex flex-col gap-4"
            >
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : null}
          {read.status === 'error' ? (
            <RegionError
              size="compact"
              message="These review details couldn’t be loaded."
              onRetry={read.onRetry}
              retrying={read.retrying}
            />
          ) : null}
          {read.status !== 'pending' &&
          read.status !== 'error' &&
          read.status !== 'ready' ? (
            <p role="status" className="text-sm text-muted-foreground">
              {read.status === 'refresh_required'
                ? 'The period has changed. Refreshing the page…'
                : read.status === 'disabled'
                  ? 'AI analysis is off for this property.'
                  : read.status === 'preparing'
                    ? 'These review details are still being prepared.'
                    : 'These details are no longer available for this property and period.'}
            </p>
          ) : null}
          {ready?.kind === 'issue' ? (
            <GuestVoiceIssueDetails drawer={ready} />
          ) : ready?.kind === 'concern' ? (
            <GuestVoiceConcernDetails drawer={ready} />
          ) : ready?.kind === 'topic' ? (
            <GuestVoiceTopicDetails drawer={ready} />
          ) : null}
        </div>
        {ready && ready.kind !== 'topic' && can('inbox.read') ? (
          <SheetFooter variant="safe-area-actions">
            <GuestVoiceIssueActions
              scope={ready.matchingReviews}
              reviewCount={
                ready.kind === 'issue' ? ready.statistics.reviewCount : ready.reviewCount
              }
            />
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
