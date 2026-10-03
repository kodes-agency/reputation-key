import { useState, type ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
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
  const [refusal, setRefusal] = useState<unknown>(null)
  const effectiveOpen = open ?? internalOpen
  const changeOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next)
    if (!next) {
      setReason('')
      setExplanation('')
      setRefusal(null)
    }
    onOpenChange?.(next)
  }

  const otherExplanation = explanation.trim()
  const canConfirm = reason !== '' && (reason !== 'other' || otherExplanation.length > 0)

  // The command may refuse (a withdrawn source, a stale revision): the dialog
  // stays open with the reason in view instead of leaking the rejection.
  const submit = async () => {
    if (!canConfirm) return
    setRefusal(null)
    try {
      await onConfirm({
        reason,
        explanation: reason === 'other' ? otherExplanation : null,
      })
    } catch (error) {
      setRefusal(error)
      return
    }
    changeOpen(false)
  }

  return (
    // Escape and an outside click are refused while the reopen is in flight,
    // exactly as Cancel is (`disabled={pending}` below). A caller that lets the
    // refusal reject — the pane, whose `updateStatus` deliberately carries no
    // toast, so one refused reopen is reported once — has it shown HERE, in the
    // banner, and a dialog dismissed mid-request would have received it closed,
    // where nobody sees it. The list's bulk reopen catches its own refusal
    // (`inbox-bulk-actions.tsx`, `handleReopen`) and reports it in the list's
    // own live region, so there this dialog just closes.
    <Dialog
      open={effectiveOpen}
      onOpenChange={(next) => {
        if (!next && pending) return
        changeOpen(next)
      }}
    >
      {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
      {/* `showCloseButton={false}`, the mobile sheet's answer to the same
          problem (`inbox-detail-sheet.tsx:95`): the primitive's corner X is a
          16x16 hit area — measured exactly 16 px at 390 px. v1 found no room
          for a 44 px square beside the title on a 288 px-wide dialog; row 20's
          36 px would crowd it less, but nobody has measured that, and the
          dialog already carries a full-width `Cancel` below, which IS the
          properly sized control — so the X stays dropped rather than grown.
          It also takes the pane's only control whose accessible name is exactly
          `Close` out of the DOM, which is the name `inbox-triage.spec.ts:85`
          and `:222` assert a count of zero for. Escape and the overlay still
          dismiss. */}
      <DialogContent showCloseButton={false} data-density="compact">
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
              <SelectTrigger
                id="inbox-reopen-reason"
                aria-label="Reason for reopening"
                // No class: the dialog is a compact surface (`data-density`),
                // so the trigger is 36 px below `md`, the Inbox's control
                // height. The bulk `Reopen` in the list wraps its toolbar
                // button in this same dialog (`inbox-bulk-actions.tsx`).
              >
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {REOPEN_REASONS.map((option) => (
                  // MENU ITEMS, so they keep 44 px below `md` while the
                  // trigger drops to 36 (row 20): five adjacent reasons stacked
                  // edge to edge with no gap, where the primitive's 32 px lets
                  // a thumb that misses one pick its neighbour — and the one
                  // picked here is written into the reopen event as the
                  // durable explanation for why the cycle came back. Measured
                  // 44 px each, zero gap between neighbours, at 390 and 320.
                  // `min-h-`, because these labels wrap at 320 px.
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
          <FormErrorBanner error={refusal} />
        </div>
        <DialogFooter>
          {/* No class on either button: the dialog is compact (`data-density`), so
              both are 36 px below `md`. The same markup is the list's bulk-reopen
              dialog (`inbox-bulk-actions.tsx`). */}
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
