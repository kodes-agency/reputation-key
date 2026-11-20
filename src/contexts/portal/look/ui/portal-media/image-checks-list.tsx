// The checks under a chosen picture (round-4 admin board 14): a tick for each
// that passes, a cross for each rule that does not, and a warning for advice
// that is not taken (a photograph narrower than a print needs), which is the
// product's warning tone and does not stop the picture being sent. The list is
// announced when it changes, so someone who cannot see it still hears why a
// picture is refused, or that it may print soft.

import { Check, X } from 'lucide-react'
import { TONE_ICON, TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import type { ImageCheck } from './image-checks'

const WarningIcon = TONE_ICON.warn

type CheckState = 'passed' | 'advice' | 'failed'

const stateOf = (check: ImageCheck): CheckState => {
  if (check.passed) return 'passed'
  return check.advisory === true ? 'advice' : 'failed'
}

/** What a screen reader hears before each line, since the icon and the colour are not read. */
const SAID: Readonly<Record<CheckState, string>> = {
  passed: 'Passed: ',
  advice: 'Advice: ',
  failed: 'Failed: ',
}

const INK: Readonly<Record<CheckState, string>> = {
  passed: 'text-foreground',
  advice: TONE_INK.warn,
  failed: 'text-negative',
}

function CheckIcon({ state }: Readonly<{ state: CheckState }>) {
  if (state === 'passed') {
    return <Check className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden />
  }
  if (state === 'advice')
    return <WarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
  return <X className="mt-0.5 size-4 shrink-0" aria-hidden />
}

export function ImageChecksList({ checks }: Readonly<{ checks: readonly ImageCheck[] }>) {
  return (
    <ul className="space-y-1.5 text-sm" aria-label="Checks" aria-live="polite">
      {checks.map((check) => {
        const state = stateOf(check)
        return (
          <li
            key={check.id}
            data-state={state}
            className={cn('flex items-start gap-2', INK[state])}
          >
            <CheckIcon state={state} />
            <span>
              <span className="sr-only">{SAID[state]}</span>
              {check.label}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
