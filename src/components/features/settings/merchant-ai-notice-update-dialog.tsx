import type { RefObject } from 'react'
import type { MerchantAiNoticeUpdate } from '#/shared/merchant-ai-notice-announcements'
import {
  Dialog,
  DialogCancel,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { InlineLink } from '#/components/ui/inline-link'
import { formatDayMonthYear } from '#/lib/format'

export function focusAfterAiUpdate(trigger?: HTMLButtonElement | null) {
  if (trigger?.isConnected) {
    trigger.focus()
    return
  }
  const main = document.querySelector('main')
  if (main) {
    main.tabIndex = -1
    main.focus({ preventScroll: true })
  }
}

export function MerchantAiNoticeUpdateDialog({
  update,
  onClose,
  returnFocus,
}: Readonly<{
  update: MerchantAiNoticeUpdate | null
  onClose: () => void
  returnFocus: RefObject<HTMLButtonElement | null>
}>) {
  return (
    <Dialog
      open={update !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        size="md"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          focusAfterAiUpdate(returnFocus.current)
        }}
      >
        <UpdateDetails update={update} onClose={onClose} />
        <DialogFooter>
          <DialogCancel>Close</DialogCancel>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function UpdateDetails({
  update,
  onClose,
}: Readonly<{ update: MerchantAiNoticeUpdate | null; onClose: () => void }>) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{update?.title}</DialogTitle>
        <DialogDescription>
          Updated automatically on {formatDayMonthYear(update?.renewedAt)}
        </DialogDescription>
      </DialogHeader>
      <ul className="list-disc space-y-3 pl-5 text-sm">
        {update?.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <p className="text-sm">
        You can turn AI features off in each property&apos;s settings.
      </p>
      <InlineLink to="/settings/ai" onClick={onClose}>
        Read the full AI notice
      </InlineLink>
    </>
  )
}
