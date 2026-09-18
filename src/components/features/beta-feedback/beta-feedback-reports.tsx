import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bug, ExternalLink, Lightbulb, MessageSquareDashed } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Skeleton } from '#/components/ui/skeleton'
import { formatDateTime } from '#/lib/format-date-time'
import { cn } from '#/lib/utils'
import { identityKeys } from '#/shared/queries/query-keys'
import type { ListMyBetaFeedback, MyBetaFeedbackItem } from './beta-feedback-form-context'
import {
  issueUrlFor,
  reporterFeedbackStatus,
  reporterRouteLabel,
  type ReporterFeedbackTone,
} from './beta-feedback-status'
import {
  browserStorage,
  markSeen,
  readSeenOutcomes,
  unseenOutcomes,
  writeSeenOutcomes,
} from './beta-feedback-updates'

// The panel only ever renders after a click, so the viewer's own zone is safe
// here and reads better than a pinned one.
const REPORT_TIME = {
  locale: 'en-US',
  timeZone:
    typeof Intl === 'undefined'
      ? 'UTC'
      : (Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'),
} as const

const TONE_CLASS: Readonly<Record<ReporterFeedbackTone, string>> = {
  pending: 'border-border text-muted-foreground',
  active: 'border-primary/20 bg-primary/5 text-primary',
  settled: 'border-positive/30 bg-positive-muted text-positive',
  closed: 'border-border bg-muted text-muted-foreground',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
}

const IN_TEXT_LINK_STYLE = { textDecorationLine: 'underline' } as const

function TrackedIssue({ reference }: Readonly<{ reference: string }>) {
  const url = issueUrlFor(reference)

  if (!url) {
    // Only the number is monospace; "Tracked as" in mono reads wide.
    return (
      <span>
        Tracked as <span className="font-mono">#{reference}</span>
      </span>
    )
  }

  return (
    <span>
      Tracked as{' '}
      {/*
        An in-text link must be distinguishable without colour (WCAG 1.4.1,
        axe link-in-text-block). The global anchor rule in styles.css sets
        `text-decoration: none` at a specificity (0,4,1) no utility class
        reaches, so the underline is an inline style, which outranks it. The
        anchor also stays inline: as a flex box it would not carry the
        underline onto its text.
      */}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={IN_TEXT_LINK_STYLE}
        className="font-mono underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        #{reference}
        <ExternalLink className="ml-0.5 inline size-3 align-middle" aria-hidden="true" />
        <span className="sr-only"> (opens GitHub in a new tab)</span>
      </a>
    </span>
  )
}

function ReportRow({
  item,
  isNew,
}: Readonly<{ item: MyBetaFeedbackItem; isNew: boolean }>) {
  const status = reporterFeedbackStatus(item)
  const Icon = item.feedbackType === 'bug' ? Bug : Lightbulb

  return (
    <li className="flex gap-3 border-b py-3 last:border-b-0">
      <Icon
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-label={item.feedbackType === 'bug' ? 'Bug report' : 'Suggestion'}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{reporterRouteLabel(item.routeKey)}</span>
          <Badge variant="outline" className={cn('font-normal', TONE_CLASS[status.tone])}>
            {status.label}
          </Badge>
          {isNew && (
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
              New
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{status.description}</p>
        <p className="text-xs text-muted-foreground">
          Sent {formatDateTime(item.createdAt, REPORT_TIME)}
          {item.engineeringIssueRef && (
            <>
              {' · '}
              <TrackedIssue reference={item.engineeringIssueRef} />
            </>
          )}
        </p>
      </div>
    </li>
  )
}

function EmptyReports() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <MessageSquareDashed className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">Nothing reported yet</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Anything you send from this panel shows up here, with where it got to.
      </p>
    </div>
  )
}

/**
 * The reporter's own history. Without it a report is a one-way message: you
 * send something, receive an opaque reference, and never learn whether it
 * mattered. Fetched only when this tab opens.
 */
export function BetaFeedbackReports({
  listFeedback,
  enabled,
  onSeen,
}: Readonly<{
  listFeedback: ListMyBetaFeedback
  enabled: boolean
  /** Told once what is on screen has been recorded as seen. */
  onSeen?: () => void
}>) {
  const query = useQuery({
    queryKey: identityKeys.myBetaFeedback(),
    queryFn: () => listFeedback(),
    enabled,
    staleTime: 30_000,
  })
  // Snapshot what had been seen BEFORE this viewing, so an outcome keeps its
  // "New" marker for the whole visit rather than vanishing on first render.
  const [seenBeforeOpening] = useState(() => readSeenOutcomes(browserStorage()))
  const newReferences = useMemo(
    () =>
      new Set(
        unseenOutcomes(query.data ?? [], seenBeforeOpening).map((item) => item.reference),
      ),
    [query.data, seenBeforeOpening],
  )

  useEffect(() => {
    if (!enabled || !query.data) return
    writeSeenOutcomes(browserStorage(), markSeen(query.data))
    onSeen?.()
  }, [enabled, query.data, onSeen])

  if (query.isPending) {
    return (
      <div className="space-y-3 py-2" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Your reports could not be loaded just now.
      </p>
    )
  }

  const items = query.data ?? []
  if (items.length === 0) return <EmptyReports />

  return (
    <ul className="max-h-96 overflow-y-auto">
      {items.map((item) => (
        <ReportRow
          key={item.reference}
          item={item}
          isNew={newReferences.has(item.reference)}
        />
      ))}
    </ul>
  )
}
