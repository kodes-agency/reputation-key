// The line under the form (board 09): whether the edits are saved as a draft and
// how many live portals use the look. The visible line changes twice at every
// pause in editing, so it is not announced; a hidden alert speaks only when a
// save did not go through. `action` is the batch "Review & publish N portals".
import type { ReactNode } from 'react'
import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { RetryButton } from '#/components/ui/region-error'
import { cn } from '#/lib/utils'
import type { LookStatus } from './property-look-rules'

type Props = Readonly<{
  status: LookStatus
  onRetry: () => void
  action?: ReactNode
}>

export function PropertyLookStatusBar({ status, onRetry, action = null }: Props) {
  const Icon =
    status.tone === 'busy' ? Loader2 : status.tone === 'warn' ? TriangleAlert : Check
  return (
    <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm">
      <p className="sr-only" role="alert">
        {status.tone === 'warn' ? status.text : null}
      </p>
      <p
        className={cn(
          'flex items-center gap-2 text-sm',
          status.tone === 'warn' ? 'text-negative' : 'text-muted-foreground',
        )}
      >
        {status.tone === 'quiet' ? null : (
          <Icon
            className={cn(
              'size-4 shrink-0',
              status.tone === 'busy' && 'animate-spin motion-reduce:animate-none',
            )}
            aria-hidden
          />
        )}
        <span>{status.text}</span>
        {status.canRetry ? <RetryButton size="xs" onRetry={onRetry} /> : null}
      </p>
      {action}
    </div>
  )
}
