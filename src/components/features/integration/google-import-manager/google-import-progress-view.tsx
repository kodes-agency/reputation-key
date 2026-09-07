import { Link } from '@tanstack/react-router'
import { AlertCircle, Clock3, RefreshCcw } from 'lucide-react'
import type {
  ImportProgressDto,
  ImportProgressItemDto,
} from '#/contexts/integration/application/public-api'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { StatCard } from '#/components/features/shared/stat-card'
import { GoogleImportProgressItems } from './google-import-progress-items'
import {
  importProgressPercent,
  importProgressSummary,
  isImportParentTerminal,
  parentStatusMessage,
} from './google-import-progress-model'

type Props = Readonly<{
  progress: ImportProgressDto
  isPollingError: boolean
  isRefreshing: boolean
  isCancelling: boolean
  retryingItemId: string | null
  onRefresh: () => void
  onRetry: (item: ImportProgressItemDto) => void
  onCancel: () => void
}>

export function GoogleImportProgressView({
  progress,
  isPollingError,
  isRefreshing,
  isCancelling,
  retryingItemId,
  onRefresh,
  onRetry,
  onCancel,
}: Props) {
  const percent = importProgressPercent(progress)
  const terminal = isImportParentTerminal(progress.status)
  const summary = importProgressSummary(progress)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">
              {parentStatusMessage(progress.status)}
            </h2>
            <Badge variant={terminal ? 'outline' : 'secondary'}>
              {progress.status === 'queued' || progress.status === 'processing' ? (
                <Clock3 aria-hidden="true" />
              ) : null}
              {progress.status.replaceAll('_', ' ')}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {progress.processedCount} of {progress.totalCount} properties processed
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!terminal ? (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isCancelling}
            >
              {isCancelling ? 'Cancelling…' : 'Cancel import'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCcw
              className={
                isRefreshing ? 'animate-spin motion-reduce:animate-none' : undefined
              }
              aria-hidden="true"
            />
            {isRefreshing ? 'Refreshing…' : 'Refresh status'}
          </Button>
        </div>
      </div>

      <div>
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Google property import progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
          {percent}% complete · Last updated{' '}
          {new Date(progress.updatedAt).toLocaleTimeString()}
        </p>
      </div>

      {isPollingError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Live updates paused</AlertTitle>
          <AlertDescription>
            The import may still be running. Use Refresh status to continue.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Imported or linked" value={summary.completed} />
        <StatCard label="Already linked" value={summary.alreadyLinked} />
        <StatCard label="Need attention" value={summary.issues} />
        <StatCard label="Remaining" value={summary.remaining} />
      </div>

      <GoogleImportProgressItems
        items={progress.items}
        retryingItemId={retryingItemId}
        onRetry={onRetry}
      />

      {terminal ? (
        <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row">
          <Button asChild>
            <Link to="/properties">View properties</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/properties/import-google">Start another import</Link>
          </Button>
        </div>
      ) : null}
    </div>
  )
}
