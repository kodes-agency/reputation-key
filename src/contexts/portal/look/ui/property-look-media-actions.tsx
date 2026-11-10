// "Replace photo" and "Remove photo" (or the logo's pair): what a person can do
// with an image already on the look. Taking it off asks first: putting it back
// means finding the file again, so it is not an action to take by slipping next
// to Replace. The confirmation owns the wait and the refusal (its banner says
// the server's own sentence for a 4xx, and a generic one for anything else).
import { Upload } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  ConfirmationDialog,
  ConfirmationTrigger,
} from '#/components/ui/confirmation-dialog'

/** What the confirmation says and does for one kind of image. */
export type MediaRemoval = Readonly<{
  /** The question: "Remove the photo?" */
  title: string
  /** What happens to the pages, and what putting it back costs. */
  description: string
  /** The button that removes it, and what Cancel keeps: "Remove photo" / "Keep photo". */
  confirmLabel: string
  cancelLabel: string
  /** Takes it off. A refusal is thrown, so the confirmation stays open and says why. */
  run: () => Promise<void>
}>

type Props = Readonly<{
  replaceLabel: string
  removeLabel: string
  removal: MediaRemoval
  onReplace: () => void
}>

export function PropertyLookMediaActions({
  replaceLabel,
  removeLabel,
  removal,
  onReplace,
}: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={onReplace}>
        <Upload aria-hidden /> {replaceLabel}
      </Button>
      <ConfirmationDialog
        trigger={
          <ConfirmationTrigger tone="destructive">{removeLabel}</ConfirmationTrigger>
        }
        title={removal.title}
        description={removal.description}
        cancelLabel={removal.cancelLabel}
        confirmLabel={removal.confirmLabel}
        pendingLabel="Removing…"
        tone="destructive"
        onConfirm={removal.run}
      />
    </div>
  )
}
