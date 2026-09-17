import { useQuery } from '@tanstack/react-query'
import { Bug, Lightbulb, MessageSquareDashed } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Skeleton } from '#/components/ui/skeleton'
import { formatDateTime } from '#/lib/format-date-time'
import { cn } from '#/lib/utils'
import { identityKeys } from '#/shared/queries/query-keys'
import type { ListMyBetaFeedback, MyBetaFeedbackItem } from './beta-feedback-form-context'
import {
  reporterFeedbackStatus,
  reporterRouteLabel,
  type ReporterFeedbackTone,
} from './beta-feedback-status'

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
  active: 'border-primary/40 bg-primary/5 text-primary',
  settled:
    'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
  closed: 'border-border bg-muted text-muted-foreground',
  failed: 'border-destructive/40 bg-destructive/5 text-destructive',
}

function ReportRow({ item }: Readonly<{ item: MyBetaFeedbackItem }>) {
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
        </div>
        <p className="text-sm text-muted-foreground">{status.description}</p>
        <p className="text-xs text-muted-foreground">
          Sent {formatDateTime(item.createdAt, REPORT_TIME)}
          {item.engineeringIssueRef && (
            <>
              {' · '}
              <span className="font-mono">Tracked as #{item.engineeringIssueRef}</span>
            </>
          )}
        </p>
      </div>
    </li>
  )
}

function EmptyReports() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
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
}: Readonly<{ listFeedback: ListMyBetaFeedback; enabled: boolean }>) {
  const query = useQuery({
    queryKey: identityKeys.myBetaFeedback(),
    queryFn: () => listFeedback(),
    enabled,
    staleTime: 30_000,
  })

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
        <ReportRow key={item.reference} item={item} />
      ))}
    </ul>
  )
}
