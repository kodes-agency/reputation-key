import { AlertTriangle, Ban } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'

export function SummaryMetric({
  term,
  value,
}: Readonly<{ term: string; value: string }>) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
      <dd className="truncate text-sm font-semibold">{value}</dd>
    </div>
  )
}

export function Detail({
  term,
  children,
}: Readonly<{ term: string; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-b p-4 last:border-b-0 sm:border-r sm:[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(3n)]:border-r-0">
      <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
      <dd className="min-w-0 truncate text-sm font-semibold">{children}</dd>
    </div>
  )
}

export function CancelGoalDialog({
  goalName,
  onCancel,
  isCancelling,
}: Readonly<{
  goalName: string
  onCancel: () => void
  isCancelling: boolean
}>) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={isCancelling}>
          <Ban data-icon="inline-start" />
          {isCancelling ? 'Cancelling...' : 'Cancel Goal'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <AlertTriangle />
          </AlertDialogMedia>
          <AlertDialogTitle>Cancel goal?</AlertDialogTitle>
          <AlertDialogDescription>
            This will stop "{goalName}" and move it to History with its current progress.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isCancelling}>Keep goal</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isCancelling}
            onClick={onCancel}
          >
            {isCancelling ? 'Cancelling...' : 'Cancel goal'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function formatValue(value: number, unit: string): string {
  const formatted = Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return unit ? `${formatted} ${unit}` : formatted
}

export function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
