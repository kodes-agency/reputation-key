// "Replace photo" and "Remove photo" (or the logo's pair): what a person can do
// with an image already on the look, and the sentence for a removal that failed.
import { Upload } from 'lucide-react'
import { Button } from '#/components/ui/button'

type Props = Readonly<{
  replaceLabel: string
  removeLabel: string
  isRemoving: boolean
  failure: string | null
  onReplace: () => void
  onRemove: () => void
}>

export function PropertyLookMediaActions({
  replaceLabel,
  removeLabel,
  isRemoving,
  failure,
  onReplace,
  onRemove,
}: Props) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onReplace}>
          <Upload aria-hidden /> {replaceLabel}
        </Button>
        <Button type="button" variant="ghost" disabled={isRemoving} onClick={onRemove}>
          {removeLabel}
        </Button>
      </div>
      {failure ? (
        <p role="alert" className="text-sm text-negative">
          {failure}
        </p>
      ) : null}
    </>
  )
}
