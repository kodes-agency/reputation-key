// The header's autosave line: "Saving…", "Draft saved", or what went wrong and
// the way to try again. The live region is always mounted so a screen reader
// hears the change; it is empty until the first edit.

import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { Button } from '#/components/ui/button'
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

  return (
    <div role="status" aria-live="polite" className="text-xs">
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
          {state.status === 'error' ? (
            <span>· {actionErrorMessage(state.error)}</span>
          ) : null}
          {view.canRetry ? (
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto p-0 text-xs"
              onClick={() => void autosave.retry()}
            >
              Retry
            </Button>
          ) : null}
        </span>
      )}
    </div>
  )
}
