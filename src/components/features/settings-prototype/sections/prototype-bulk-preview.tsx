// PROTOTYPE — the dry run every bulk apply goes through: a before -> after list, an
// honest note that a copy is applied once (the properties will not follow a default),
// per-row results afterwards and one audit entry per batch. The apply is a fake.
import { useState, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogCancel,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'

export type BulkChange = Readonly<{
  id: string
  name: string
  before: string
  after: string
}>

type Props = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** What the person chooses before the preview (the language to set, the manager to add). */
  controls?: ReactNode
  changes: readonly BulkChange[]
  /** Appended to the preview: what applying means ("These properties will not follow a default."). */
  footnote?: string
  onApplied?: () => void
}>

const FAKE_APPLY_MS = 700

export function BulkPreviewDialog({ open, onOpenChange, ...body }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <PreviewBody {...body} />
      </DialogContent>
    </Dialog>
  )
}

function PreviewBody({
  title,
  description,
  controls,
  changes,
  footnote,
  onApplied,
}: Omit<Props, 'open' | 'onOpenChange'>) {
  const [phase, setPhase] = useState<'preview' | 'applying' | 'done'>('preview')
  const changed = changes.filter((change) => change.before !== change.after)
  const unchanged = changes.length - changed.length

  const apply = () => {
    setPhase('applying')
    setTimeout(() => {
      setPhase('done')
      onApplied?.()
    }, FAKE_APPLY_MS)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{phase === 'done' ? 'Applied' : title}</DialogTitle>
        <DialogDescription>
          {phase === 'done'
            ? `${changed.length} updated, logged as one audit entry.`
            : description}
        </DialogDescription>
      </DialogHeader>
      {phase === 'done' ? null : controls}
      {changed.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing would change.</p>
      ) : (
        <ul className="max-h-72 divide-y overflow-auto rounded-lg border text-sm">
          {changed.map((change) => (
            <li key={change.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1 truncate">{change.name}</span>
              <span className="text-muted-foreground">{change.before}</span>
              <ArrowRight
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="font-medium">{change.after}</span>
              {phase === 'done' ? <Badge variant="positive">Updated</Badge> : null}
            </li>
          ))}
        </ul>
      )}
      {unchanged > 0 ? (
        <p className="text-sm text-muted-foreground">
          {unchanged} already match and are left alone.
        </p>
      ) : null}
      {footnote && phase !== 'done' ? (
        <p className="text-sm text-muted-foreground">{footnote}</p>
      ) : null}
      <DialogFooter>
        {phase === 'done' ? (
          <DialogClose asChild>
            <Button>Close</Button>
          </DialogClose>
        ) : (
          <>
            <DialogCancel>Cancel</DialogCancel>
            <Button
              pending={phase === 'applying'}
              disabled={changed.length === 0}
              onClick={apply}
            >
              Apply to {changed.length}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  )
}
