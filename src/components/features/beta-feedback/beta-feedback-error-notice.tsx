import { AlertTriangle } from 'lucide-react'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'

type Props = Readonly<{
  eventId: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}>

/**
 * Offered only when monitoring recorded an error in this tab. Including it
 * sends the opaque event id and nothing else — the error itself is already in
 * monitoring, so this only tells triage which one the reporter means.
 */
export function BetaFeedbackErrorNotice({
  eventId,
  checked,
  onCheckedChange,
  disabled,
}: Props) {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-500/35 bg-amber-500/5 p-3">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium">
          RepKey recorded an error while you were here
        </p>
        <div className="flex items-start gap-2">
          <Checkbox
            id="beta-feedback-include-error"
            checked={checked}
            onCheckedChange={(value) => onCheckedChange(value === true)}
            disabled={disabled}
            className="mt-0.5"
          />
          <Label
            htmlFor="beta-feedback-include-error"
            className="text-sm leading-snug font-normal text-muted-foreground"
          >
            Attach it to this report so we can find the exact failure. Only the reference{' '}
            <code className="font-mono text-xs">{eventId.slice(0, 8)}</code> is sent.
          </Label>
        </div>
      </div>
    </div>
  )
}
