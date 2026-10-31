import { useEffect, useEffectEvent, useRef, type RefObject } from 'react'
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
type ReadyDrawer = Extract<GuestVoiceDetailRead, { status: 'ready' }>['drawer']

function drawerTitle(
  drawer: ReadyDrawer | null,
  target: GuestVoiceDetailTarget,
  knownTitle: string | undefined,
  navigation: GuestVoiceDetailNavigation | undefined,
): string {
  if (drawer) return drawer.kind === 'topic' ? topicLabel(drawer.topic) : drawer.title
  if (target.kind === 'topic') return topicLabel(target.topic)
  return knownTitle ?? navigation?.knownTitle() ?? 'Review details'
}

function GuestVoiceDrawerHeader({
  drawer,
  title,
  titleRef,
  navigation,
}: Readonly<{
  drawer: ReadyDrawer | null
  title: string
  titleRef: RefObject<HTMLHeadingElement | null>
  navigation?: GuestVoiceDetailNavigation
}>) {
  const back = navigation?.backLabel()
  return (
    <SheetHeader className="shrink-0 border-b pr-14">
      {back ? (
        <BackButton
          label={`Back to ${back}`}
          onClick={navigation?.back}
          className="self-start"
        />
      ) : null}
      {drawer && drawer.kind !== 'concern' ? (
        <ReadableBadge variant="neutral">
          <GuestVoiceTopicIcon topic={drawer.topic} />
          {topicLabel(drawer.topic)}
        </ReadableBadge>
      ) : null}
      <SheetTitle ref={titleRef} tabIndex={-1}>
        {title}
      </SheetTitle>
      <SheetDescription>
        {drawer?.kind === 'concern'
          ? 'Serious concern reported by guests'
          : 'Counts and evidence from this period'}
      </SheetDescription>
    </SheetHeader>
  )
}

function GuestVoiceDrawerDetails({ drawer }: Readonly<{ drawer: ReadyDrawer }>) {
  switch (drawer.kind) {
    case 'issue':
      return <GuestVoiceIssueDetails drawer={drawer} />
    case 'concern':
      return <GuestVoiceConcernDetails drawer={drawer} />
    case 'topic':
      return <GuestVoiceTopicDetails drawer={drawer} />
  }
}

function GuestVoiceDrawerBody({ read }: Readonly<{ read: GuestVoiceDrawerRead }>) {
  switch (read.status) {
    case 'ready':
      return <GuestVoiceDrawerDetails drawer={read.drawer} />
    case 'pending':
      return (
        <div
          role="status"
          aria-label="Reading review details"
          className="flex flex-col gap-4"
        >
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-28 w-full" />
        </div>
      )
    case 'error':
      return (
        <RegionError
          size="compact"
          message="These review details couldn’t be loaded."
          onRetry={read.onRetry}
          retrying={read.retrying}
        />
      )
    default:
      return (
        <p role="status" className="text-sm text-muted-foreground">
          {read.status === 'refresh_required'
            ? 'The period has changed. Refreshing the page…'
            : read.status === 'disabled'
              ? 'AI analysis is off for this property.'
              : read.status === 'preparing'
                ? 'These review details are still being prepared.'
                : 'These details are no longer available for this property and period.'}
        </p>
      )
  }
}

function GuestVoiceDrawerFooter({ drawer }: Readonly<{ drawer: ReadyDrawer | null }>) {
  const { can } = usePermissions()
  if (!drawer || drawer.kind === 'topic' || !can('inbox.read')) return null
  return (
    <SheetFooter variant="safe-area-actions">
      <GuestVoiceIssueActions
        scope={drawer.matchingReviews}
        reviewCount={
          drawer.kind === 'issue' ? drawer.statistics.reviewCount : drawer.reviewCount
        }
      />
    </SheetFooter>
  )
}

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
  const titleRef = useRef<HTMLHeadingElement>(null)
  const ready = read.status === 'ready' ? read.drawer : null
  const title = drawerTitle(ready, target, knownTitle, navigation)
  const restoreDetail = useEffectEvent(() => navigation?.ready(title))
  useEffect(() => {
    if (!ready) return
    restoreDetail()
    titleRef.current?.focus({ preventScroll: true })
  }, [ready, title])
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
        <GuestVoiceDrawerHeader
          drawer={ready}
          title={title}
          titleRef={titleRef}
          navigation={navigation}
        />
        <div
          data-slot="guest-voice-detail-body"
          ref={navigation?.scrollRef}
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 md:p-5"
        >
          <GuestVoiceDrawerBody read={read} />
        </div>
        <GuestVoiceDrawerFooter drawer={ready} />
      </SheetContent>
    </Sheet>
  )
}
