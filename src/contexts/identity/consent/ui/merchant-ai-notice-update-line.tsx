import { useRef, useState } from 'react'
import type { MerchantAiNoticeUpdate } from '#/shared/merchant-ai-notice-announcements'
import { Button } from '#/components/ui/button'
import { formatDayMonthYear } from '#/lib/format'
import { MerchantAiNoticeUpdateDialog } from './merchant-ai-notice-update-dialog'

export function MerchantAiNoticeUpdateLine({
  update,
  onSeen,
}: Readonly<{
  update: MerchantAiNoticeUpdate
  onSeen?: (update: MerchantAiNoticeUpdate) => Promise<unknown>
}>) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span>
        Updated automatically on {formatDayMonthYear(update.renewedAt)}: {update.title}
      </span>
      <Button
        ref={trigger}
        size="inline"
        variant="link"
        touch
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true)
          void onSeen?.(update).catch(() => {})
        }}
      >
        What changed
      </Button>
      <MerchantAiNoticeUpdateDialog
        update={open ? update : null}
        onClose={() => setOpen(false)}
        returnFocus={trigger}
      />
    </div>
  )
}
