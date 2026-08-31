import { useState, type ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'
import type { ManualReopenReason } from '#/contexts/inbox/application/public-api'

export type InboxReopenDecision = Readonly<{
  reason: ManualReopenReason
  explanation: string | null
}>

const REOPEN_REASONS: ReadonlyArray<
  Readonly<{ value: ManualReopenReason; label: string }>
> = [
  {
    value: 'guest_follow_up_still_needed',
    label: 'Guest follow-up is still needed',
  },
  {
    value: 'internal_follow_up_still_needed',
    label: 'Internal follow-up is still needed',
  },
  { value: 'new_information', label: 'New information' },
  { value: 'correcting_handling_status', label: 'Correcting handling status' },
  { value: 'other', label: 'Other' },
]

type Props = Readonly<{
  children?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  itemCount?: number
  pending: boolean
  onConfirm: (decision: InboxReopenDecision) => Promise<unknown>
}>

export function InboxReopenDialog({
  children,
  open,
  onOpenChange,
  itemCount = 1,
  pending,
  onConfirm,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [reason, setReason] = useState<ManualReopenReason | ''>('')
  const [explanation, setExplanation] = useState('')
  const effectiveOpen = open ?? internalOpen
  const changeOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next)
    if (!next) {
      setReason('')
      setExplanation('')
    }
    onOpenChange?.(next)
  }

  const otherExplanation = explanation.trim()
  const canConfirm = reason !== '' && (reason !== 'other' || otherExplanation.length > 0)

  const submit = async () => {
    if (!canConfirm) return
    await onConfirm({
      reason,
      explanation: reason === 'other' ? otherExplanation : null,
    })
    changeOpen(false)
  }

  return (
    <Dialog open={effectiveOpen} onOpenChange={changeOpen}>
      {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {itemCount === 1 ? 'Reopen work' : `Reopen ${itemCount} items`}
          </DialogTitle>
          <DialogDescription>
            Choose a neutral reason. Earlier handling decisions and timing results stay
            unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="inbox-reopen-reason">Reason</Label>
            <Select
              value={reason}
              onValueChange={(value) => {
                const next = value as ManualReopenReason
                setReason(next)
                if (next !== 'other') setExplanation('')
              }}
              disabled={pending}
            >
              <SelectTrigger id="inbox-reopen-reason" aria-label="Reason for reopening">
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {REOPEN_REASONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {reason === 'other' ? (
            <div className="grid gap-2">
              <Label htmlFor="inbox-reopen-explanation">Short explanation</Label>
              <Textarea
                id="inbox-reopen-explanation"
                value={explanation}
                maxLength={280}
                onChange={(event) => setExplanation(event.target.value)}
                disabled={pending}
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => changeOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!canConfirm || pending}>
            Reopen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
