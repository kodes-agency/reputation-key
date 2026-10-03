// The row's facts line: what the title leaves out, in one muted line —
// "Riverside Hotel · ★★ · waited 1d · ×3".
//
// Every field is optional (ADR 0046 r.8 payloads carry only what was captured),
// so this renders nothing at all rather than a row of empty separators. No
// identifier ever appears here — `resourceId` lives in the deep link only. The
// wait is fixed, like the row's own time: the item may have been answered
// since, so it never keeps counting.

import type { ReactNode } from 'react'
import { StarRating } from '#/components/ui/star-rating'
import type { NotificationRowView } from './notification-row-view'

type Props = Readonly<{ view: NotificationRowView }>

export function NotificationRowMeta({ view }: Props) {
  const facts: ReactNode[] = []
  if (view.property !== null) facts.push(view.property)
  if (view.tone === 'done') facts.push(<span className="text-positive">Done</span>)
  if (view.targetPassed) {
    facts.push(<span className="font-medium text-negative">Target passed</span>)
  }
  if (view.rating !== undefined) {
    facts.push(<StarRating value={view.rating} label={`Rated ${view.rating} of 5`} />)
  }
  if (view.waited !== '') facts.push(`waited ${view.waited}`)
  if (view.repeats > 1) facts.push(`×${view.repeats}`)
  if (facts.length === 0) return null

  return (
    <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      {facts.map((fact, index) => (
        <span key={index} className="inline-flex items-center gap-1.5">
          {index > 0 && <span aria-hidden="true">·</span>}
          {fact}
        </span>
      ))}
    </span>
  )
}
