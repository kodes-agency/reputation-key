// BETA-2 B2.6: Irreversible action confirmation dialog.
//
// Shows exact property/review/person, impact summary, and recovery boundary
// before destructive actions (publish, disconnect, archive, purge).
// Ensures users understand consequences before confirming.

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { AlertTriangle } from 'lucide-react'
import { cn } from '#/lib/utils'
import type { ReactNode } from 'react'

type Impact = 'reversible' | 'irreversible' | 'external'

type ConfirmationDialogProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** What will happen if confirmed. */
  consequences: readonly string[]
  /** Whether this action can be undone. */
  impact: Impact
  /** Text for the confirm button. */
  confirmLabel?: string
  /** Whether the action is currently pending. */
  pending?: boolean
  onConfirm: () => void
  children?: ReactNode
}>

const IMPACT_STYLES: Record<Impact, { className: string; label: string }> = {
  reversible: {
    className: 'border-muted',
    label: 'This action can be undone.',
  },
  irreversible: {
    className: 'border-destructive/30',
    label: 'This action cannot be undone.',
  },
  external: {
    className: 'border-warning/30',
    label: 'This action has external effects and cannot be fully reversed.',
  },
}

/**
 * Confirmation dialog for significant actions. Shows impact, consequences,
 * and recoverability. Uses AlertDialog for accessibility (focus trap,
 * escape to cancel, screen reader announcement).
 */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  consequences,
  impact,
  confirmLabel = 'Confirm',
  pending = false,
  onConfirm,
  children,
}: ConfirmationDialogProps) {
  const style = IMPACT_STYLES[impact]

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={cn('max-w-md', style.className)}>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {impact !== 'reversible' && (
              <AlertTriangle
                className={cn(
                  'size-5 shrink-0',
                  impact === 'irreversible' ? 'text-destructive' : 'text-warning',
                )}
                aria-hidden="true"
              />
            )}
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>{description}</p>
              {consequences.length > 0 && (
                <ul className="list-disc space-y-1 pl-4 text-sm">
                  {consequences.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
              <p
                className={cn(
                  'text-xs font-medium',
                  impact === 'irreversible' && 'text-destructive',
                  impact === 'external' && 'text-warning',
                  impact === 'reversible' && 'text-muted-foreground',
                )}
              >
                {style.label}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            disabled={pending}
            className={cn(
              impact === 'irreversible' &&
                'bg-destructive text-destructive-foreground hover:bg-destructive/90',
            )}
          >
            {pending ? 'Working…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
