// The checks under a chosen picture (round-4 admin board 14): a tick for each
// that passes, a cross for each that does not. The list is announced when it
// changes, so someone who cannot see it still hears why a picture is refused.

import { Check, X } from 'lucide-react'
import { cn } from '#/lib/utils'
import type { ImageCheck } from './image-checks'

export function ImageChecksList({ checks }: Readonly<{ checks: readonly ImageCheck[] }>) {
  return (
    <ul className="space-y-1.5 text-sm" aria-label="Checks" aria-live="polite">
      {checks.map((check) => (
        <li
          key={check.id}
          className={cn(
            'flex items-start gap-2',
            check.passed ? 'text-foreground' : 'text-negative',
          )}
        >
          {check.passed ? (
            <Check className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden />
          ) : (
            <X className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <span>
            <span className="sr-only">{check.passed ? 'Passed: ' : 'Failed: '}</span>
            {check.label}
          </span>
        </li>
      ))}
    </ul>
  )
}
