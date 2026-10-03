// The header's autosave line: "Saving…", "Draft saved", or what went wrong and
// the way to try again. The visible line is not itself announced: it changes
// twice at every pause in typing, which would be two announcements per pause. A
// visually hidden alert, always mounted, speaks only when a save did not go
// through.

import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { RetryButton } from '#/components/ui/region-error'
import { cn } from '#/lib/utils'
import {
  usePortalDraftAutosave,
  usePortalDraftAutosaveState,
} from './portal-draft-autosave-context'
import { describePortalDraftSaveStatus } from './portal-draft-save-status-rules'

export function PortalDraftSaveStatus() {
  const autosave = usePortalDraftAutosave()
  const state = usePortalDraftAutosaveState()
  const view = describePortalDraftSaveStatus(state)
  const problem = state.status === 'error' ? actionErrorMessage(state.error) : null
  const spoken =
    view?.tone === 'warn' ? [view.label, problem].filter(Boolean).join('. ') : null

  return (
    <div className="text-xs">
      <p className="sr-only" role="alert">
        {spoken}
      </p>
      <div role="status" aria-live="off">
        {view === null ? null : (
          <span
            className={cn(
              'inline-flex flex-wrap items-center gap-x-1.5',
              view.tone === 'warn' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {view.tone === 'busy' ? (
              <Loader2
                className="size-3 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : view.tone === 'ok' ? (
              <Check className="size-3" aria-hidden />
            ) : (
              <AlertTriangle className="size-3" aria-hidden />
            )}
            <span>{view.label}</span>
            {problem === null ? null : <span>· {problem}</span>}
            {view.canRetry ? (
              <RetryButton size="xs" onRetry={() => void autosave.retry()} />
            ) : null}
          </span>
        )}
      </div>
    </div>
  )
}
