// BETA-2 B2.1: First-run guide states.
// Actionable empty states guiding users through the setup journey.

import {
  Building2,
  Link2,
  Download,
  RefreshCw,
  MessageSquare,
  Archive,
} from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'
import { Button } from '#/components/ui/button'

type GuideProps = Readonly<{ onAction?: () => void }>

export function NoPropertyState({ onAction }: GuideProps) {
  return (
    <EmptyState icon={Building2} title="Create your first property">
      <p className="text-sm text-muted-foreground max-w-sm">
        Add a property to start managing reviews and publishing replies.
      </p>
      {onAction && (
        <Button size="sm" onClick={onAction}>
          Create property
        </Button>
      )}
    </EmptyState>
  )
}

export function GoogleNotConnectedState({ onAction }: GuideProps) {
  return (
    <EmptyState icon={Link2} title="Connect Google Business Profile">
      <p className="text-sm text-muted-foreground max-w-sm">
        Connect your Google account to import reviews and publish replies.
      </p>
      {onAction && (
        <Button size="sm" onClick={onAction}>
          Connect Google
        </Button>
      )}
    </EmptyState>
  )
}

export function ImportingState({
  importedCount,
  totalCount,
}: Readonly<{ importedCount: number; totalCount?: number }>) {
  const pct =
    totalCount && totalCount > 0
      ? Math.round((importedCount / totalCount) * 100)
      : undefined
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border py-12 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Download
          className="size-4 animate-pulse text-muted-foreground"
          aria-hidden="true"
        />
      </div>
      <p className="text-sm font-medium">Importing reviews…</p>
      <p className="text-sm text-muted-foreground">
        {importedCount.toLocaleString()} imported{pct !== undefined ? ` (${pct}%)` : ''}
      </p>
      <p className="text-xs text-muted-foreground">Import continues in the background.</p>
    </div>
  )
}

export function ReauthRequiredState({ onAction }: GuideProps) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10">
        <RefreshCw className="size-4 text-destructive" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium">Google re-authentication required</p>
      <p className="text-sm text-muted-foreground max-w-sm">
        Your Google connection expired or was revoked. Reconnect to resume review sync.
      </p>
      {onAction && (
        <Button variant="destructive" size="sm" onClick={onAction}>
          Reconnect Google
        </Button>
      )}
    </div>
  )
}

export function NoReviewsState() {
  return (
    <EmptyState icon={MessageSquare} title="No reviews yet">
      <p className="text-sm text-muted-foreground max-w-sm">
        Your Google connection is active. Reviews appear here automatically.
      </p>
    </EmptyState>
  )
}

export function PropertyArchivedState({ onAction }: GuideProps) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-muted py-12 text-center"
      role="status"
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Archive className="size-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium">This property is archived</p>
      <p className="text-sm text-muted-foreground max-w-sm">
        Sync and publishing are paused. Data is preserved for recovery.
      </p>
      {onAction && (
        <Button variant="outline" size="sm" onClick={onAction}>
          Restore property
        </Button>
      )}
    </div>
  )
}

export type PropertySetupState =
  | { kind: 'no_property' }
  | { kind: 'not_connected' }
  | { kind: 'importing'; importedCount: number; totalCount?: number }
  | { kind: 'reauth_required' }
  | { kind: 'no_reviews' }
  | { kind: 'archived' }
  | { kind: 'ready' }

export function SetupGuideState({
  state,
  onCreateProperty,
  onConnectGoogle,
  onReconnectGoogle,
  onRestoreProperty,
}: Readonly<{
  state: PropertySetupState
  onCreateProperty?: () => void
  onConnectGoogle?: () => void
  onReconnectGoogle?: () => void
  onRestoreProperty?: () => void
}>) {
  switch (state.kind) {
    case 'no_property':
      return <NoPropertyState onAction={onCreateProperty} />
    case 'not_connected':
      return <GoogleNotConnectedState onAction={onConnectGoogle} />
    case 'importing':
      return (
        <ImportingState
          importedCount={state.importedCount}
          totalCount={state.totalCount}
        />
      )
    case 'reauth_required':
      return <ReauthRequiredState onAction={onReconnectGoogle} />
    case 'no_reviews':
      return <NoReviewsState />
    case 'archived':
      return <PropertyArchivedState onAction={onRestoreProperty} />
    case 'ready':
      return null
  }
}
