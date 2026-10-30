// The Guest voice row of Overview (redesign rows 4, 12).
//
// One sentence and two chips, not a section. What stays on the front page is the
// single most useful thing the analysis produces: the problem to fix first and what
// guests love most, in a line. Both come from the Guest voice page's own read (the v3
// analysis), the same query entry, so opening the page from here finds it warm.
//
// Self-fetching and failure-isolated, like the sections it replaces. Unlike
// them it never renders nothing: a property with the capability off gets the
// one line and the action that turns it on, because "AI analysis is available
// and off" is exactly what a week-one manager needs to know (row 12).
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { MessagesSquare } from 'lucide-react'
import type { getGuestVoiceV2Fn } from '#/contexts/ai/server/guest-voice-v2'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { ROW_FIGURE_LINK } from '#/components/ui/row-link'
import { Skeleton } from '#/components/ui/skeleton'
import { cn } from '#/lib/utils'
import { aiKeys } from '#/shared/queries/query-keys'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { issueReviewsSearch } from './guest-voice/guest-voice-links'
import {
  OVERVIEW_GUEST_VOICE_RANGE,
  overviewIssueCountText,
  overviewTopIssues,
  type OverviewGuestVoiceReady,
  type OverviewIssue,
} from './overview-guest-voice-issues'

export type OverviewGuestVoiceServerFns = Readonly<{
  getGuestVoice: typeof getGuestVoiceV2Fn
}>

function Row({
  children,
  action,
}: Readonly<{ children: React.ReactNode; action?: React.ReactNode }>) {
  return (
    <section aria-labelledby="overview-guest-voice" className="space-y-3">
      <h2 id="overview-guest-voice" className="text-lg font-semibold tracking-tight">
        Guest voice
      </h2>
      <div className="flex flex-col items-start gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <MessagesSquare
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="min-w-0 space-y-2">{children}</div>
        </div>
        {action}
      </div>
    </section>
  )
}

function ReadMore({ propertyId }: Readonly<{ propertyId: string }>) {
  return (
    <Button asChild variant="outline" className="shrink-0">
      <Link to="/properties/$propertyId/guests" params={{ propertyId }}>
        All topics
      </Link>
    </Button>
  )
}

function AnalysisOff({ propertyId }: Readonly<{ propertyId: string }>) {
  const { can } = usePermissions()
  const canManage = can('ai.manage')
  return (
    <Row
      action={
        canManage ? (
          <Button asChild className="shrink-0">
            <Link to="/properties/$propertyId/settings/ai" params={{ propertyId }}>
              Turn on AI analysis
            </Link>
          </Button>
        ) : undefined
      }
    >
      <p className="text-sm">
        Turn on AI analysis to see what guests praise and complain about.
      </p>
      {canManage ? null : (
        <p className="text-sm text-muted-foreground">
          An account admin can turn it on in this property&apos;s AI settings.
        </p>
      )}
    </Row>
  )
}

/**
 * One issue and how many of the reviews that name it, opened in the Inbox on the same
 * days the figure counts: a problem's reviews are the ones that complain of it, praise's
 * the ones that praise it.
 */
function IssueChip({
  tone,
  issue,
  read,
  propertyId,
}: Readonly<{
  tone: 'praise' | 'complaint'
  issue: OverviewIssue
  read: OverviewGuestVoiceReady
  propertyId: string
}>) {
  const text = overviewIssueCountText(issue)
  return (
    <Link
      to="/inbox"
      search={issueReviewsSearch({
        propertyId,
        startLocalDate: read.startLocalDate,
        endLocalDate: read.endLocalDate,
        issueId: issue.issueId,
        sense: tone,
      })}
      aria-label={`${tone === 'praise' ? 'Praise' : 'Complaints'}: ${text}; open in inbox`}
      className={cn('flex min-h-11 items-center gap-1.5 md:min-h-0', ROW_FIGURE_LINK)}
    >
      <Badge variant={tone === 'praise' ? 'positive' : 'negative'}>
        {tone === 'praise' ? 'Praise' : 'Complaints'}
      </Badge>
      {text}
    </Link>
  )
}

function IssueSummary({
  read,
  propertyId,
}: Readonly<{ read: OverviewGuestVoiceReady; propertyId: string }>) {
  const { complaint, praise, sentence } = overviewTopIssues(read)

  if (!praise && !complaint) {
    return (
      <Row action={<ReadMore propertyId={propertyId} />}>
        <p className="text-sm">
          No issue or praise stands out in the reviews analysed so far.
        </p>
      </Row>
    )
  }

  return (
    <Row action={<ReadMore propertyId={propertyId} />}>
      {sentence === null ? null : <p className="text-sm font-medium">{sentence}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {praise ? (
          <IssueChip tone="praise" issue={praise} read={read} propertyId={propertyId} />
        ) : null}
        {complaint ? (
          <IssueChip
            tone="complaint"
            issue={complaint}
            read={read}
            propertyId={propertyId}
          />
        ) : null}
      </div>
    </Row>
  )
}

export function OverviewGuestVoice({
  propertyId,
  serverFns,
}: Readonly<{ propertyId: string; serverFns: OverviewGuestVoiceServerFns }>) {
  const reading = useQuery({
    queryKey: aiKeys.guestVoiceV2(propertyId, OVERVIEW_GUEST_VOICE_RANGE),
    queryFn: () =>
      serverFns.getGuestVoice({
        data: { propertyId, range: OVERVIEW_GUEST_VOICE_RANGE },
      }),
    staleTime: 60_000,
    retry: false,
  })

  if (reading.isPending) {
    return (
      // The action's height is held: the answer this strip most often gives
      // ("Turn on AI analysis") has a button, and a card without one is 16 px
      // shorter than the page it becomes (server HTML vs hydrated page).
      <Row action={<Skeleton className="h-9 w-40 shrink-0" aria-hidden="true" />}>
        <p className="text-sm text-muted-foreground">Reading what guests said…</p>
      </Row>
    )
  }

  if (reading.isError) {
    return (
      <Row>
        <p className="text-sm text-muted-foreground">
          Guest voice is unavailable right now. Everything else on this page is
          unaffected.
        </p>
      </Row>
    )
  }

  const read = reading.data
  if (read.status === 'disabled') return <AnalysisOff propertyId={propertyId} />

  if (read.status === 'not_enough_reviews') {
    return (
      <Row action={<ReadMore propertyId={propertyId} />}>
        <p className="text-sm">
          Too few reviews with text yet to spot patterns. The latest ones are on the Guest
          voice page.
        </p>
      </Row>
    )
  }

  // Not analysed under v3 yet (the replay is still running, or nothing is analysable).
  if (read.status !== 'ready') {
    return (
      <Row action={<ReadMore propertyId={propertyId} />}>
        <p className="text-sm">
          Analysing your reviews. Topics appear as soon as there is enough to say.
        </p>
      </Row>
    )
  }

  return <IssueSummary read={read} propertyId={propertyId} />
}
