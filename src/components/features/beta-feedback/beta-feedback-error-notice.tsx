import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
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
    <Alert variant="warning" role="status">
      <AlertTitle className="line-clamp-none">
        RepKey recorded an error while you were here
      </AlertTitle>
      <AlertDescription className="gap-2">
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
            className="block space-y-1 text-sm leading-snug font-normal text-muted-foreground"
          >
            <span className="block">
              Attach it to this report so we can find the exact failure.
            </span>
            {/* Its own line: inline, the chip breaks the sentence badly. */}
            <span className="block text-xs">
              Only the reference <code className="font-mono">{eventId.slice(0, 8)}</code>{' '}
              is sent.
            </span>
          </Label>
        </div>
      </AlertDescription>
    </Alert>
  )
}
