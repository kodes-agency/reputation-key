import { CheckCircle2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { DialogClose, DialogFooter } from '#/components/ui/dialog'

type Props = Readonly<{
  reference: string
  onTrackReports: () => void
  onReportAnother: () => void
}>

export function BetaFeedbackReceipt({
  reference,
  onTrackReports,
  onReportAnother,
}: Props) {
  return (
    <div className="space-y-5 py-2" aria-live="polite">
      <div className="flex gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 className="size-5" />
        </div>
        <div className="space-y-1">
          <h3 className="font-medium">Thanks — we received it</h3>
          <p className="text-sm text-muted-foreground">
            Your report reached the RepKey beta team. It does not create a public issue.
          </p>
        </div>
      </div>
      <div className="rounded-md border bg-muted/35 px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">Reference</p>
        <p className="mt-1 break-all font-mono text-sm">{reference}</p>
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        <Button type="button" variant="ghost" onClick={onReportAnother}>
          Report something else
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onTrackReports}>
            Track it
          </Button>
          <DialogClose asChild>
            <Button type="button">Done</Button>
          </DialogClose>
        </div>
      </DialogFooter>
    </div>
  )
}
