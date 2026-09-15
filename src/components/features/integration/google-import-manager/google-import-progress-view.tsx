import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertCircle, ChevronDown, Clock3, RefreshCcw } from 'lucide-react'
import type {
  ImportProgressDto,
  ImportProgressItemDto,
} from '#/contexts/integration/application/public-api'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { StatCard } from '#/components/features/shared/stat-card'
import { GoogleImportProgressItems } from './google-import-progress-items'
import {
  importProgressPercent,
  importProgressSummary,
  importedPropertiesForAi,
  isImportParentTerminal,
  parentStatusMessage,
} from './google-import-progress-model'

type Props = Readonly<{
  progress: ImportProgressDto
  /** The wizard's "Set up properties" step, shown once the import settles. */
  setupStep: ReactNode
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
  setupStep,
  isPollingError,
  isRefreshing,
  isCancelling,
  retryingItemId,
  onRefresh,
  onRetry,
  onCancel,
}: Props) {
  const terminal = isImportParentTerminal(progress.status)
  const summary = importProgressSummary(progress)
  const settingUp = terminal && importedPropertiesForAi(progress).length > 0
  const items = (
    <GoogleImportProgressItems
      items={progress.items}
      retryingItemId={retryingItemId}
      onRetry={onRetry}
    />
  )

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

      <ImportProgressMeter progress={progress} />

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

      {settingUp ? (
        <>
          {setupStep}
          {/* The import is done: its rows step back so setup has the focus,
              unless one of them still needs attention. */}
          <Collapsible
            defaultOpen={summary.issues > 0}
            className="space-y-3 border-t pt-5"
          >
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" className="group -ml-3">
                Import details
                <ChevronDown
                  aria-hidden="true"
                  className="transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>{items}</CollapsibleContent>
          </Collapsible>
        </>
      ) : (
        items
      )}

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

/** The progress bar and its caption: how far the worker got, and when we last heard. */
function ImportProgressMeter({ progress }: Readonly<{ progress: ImportProgressDto }>) {
  const percent = importProgressPercent(progress)
  const queued = progress.status === 'queued'
  return (
    <div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Google property import progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={queued ? undefined : percent}
        aria-valuetext={queued ? 'Queued, waiting for the import worker' : undefined}
      >
        {queued ? (
          // A freshly committed import has nothing processed yet; an empty
          // bar reads as "nothing happened". Show motion until the worker
          // settles the first item.
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60 motion-reduce:animate-none" />
        ) : (
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
        {queued
          ? 'Queued · the import worker picks this up within seconds'
          : `${percent}% complete`}
        {' · Last updated '}
        {new Date(progress.updatedAt).toLocaleTimeString()}
      </p>
    </div>
  )
}
