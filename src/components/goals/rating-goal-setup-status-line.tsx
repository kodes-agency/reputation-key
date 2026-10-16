// The line under the goal on the one-screen setup: the parts
// `rating-goal-setup-status.ts` works out, in its order, a quiet dot between
// them. "Recommended" is the tag; a link is a step the manager can take from
// here (the faster pace, the way back to the recommendation).
import { Fragment } from 'react'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import type { StatusAction, StatusPart } from './rating-goal-setup-status'

export function RatingGoalSetupStatusLine({
  parts,
  small,
  onAction,
}: Readonly<{
  parts: readonly StatusPart[]
  small: boolean
  onAction: (action: StatusAction) => void
}>) {
  return (
    <p
      data-slot="rating-goal-status"
      className={cn(
        'flex items-center gap-x-2 text-sm',
        small && 'flex-wrap justify-center text-center',
      )}
      style={{ minHeight: small ? 28 : 30 }}
    >
      {parts.map((part, index) => (
        <Fragment key={`${part.kind}-${part.text}`}>
          {index > 0 ? (
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
          ) : null}
          {part.kind === 'tag' ? (
            <span className="text-xs font-semibold text-link">{part.text}</span>
          ) : part.kind === 'text' ? (
            <span className="text-muted-foreground">{part.text}</span>
          ) : (
            <Button
              type="button"
              variant="link"
              size="inline"
              touch
              onClick={() => onAction(part.action)}
            >
              {part.text}
            </Button>
          )}
        </Fragment>
      ))}
    </p>
  )
}
