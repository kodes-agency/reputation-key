import { useRef, useState, type RefObject } from 'react'
import type { MerchantAiNoticeUpdate } from '#/shared/merchant-ai-notice-announcements'
import { PAGE_GUTTER_X } from '#/components/layout/page-shell'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import {
  MerchantAiNoticeUpdateDialog,
  focusAfterAiUpdate,
} from './merchant-ai-notice-update-dialog'

type Props = Readonly<{
  update: MerchantAiNoticeUpdate | null
  markSeen: (update: MerchantAiNoticeUpdate) => Promise<unknown>
  pending: boolean
}>

/** The dialog stays mounted when the successful receipt removes the banner. */
export function MerchantAiNoticeUpdateBanner({ update, markSeen, pending }: Props) {
  const [opened, setOpened] = useState<MerchantAiNoticeUpdate | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const visible =
    update !== null && dismissed !== `${update.noticeVersion}:${update.noticeDigest}`
  const recordSeen = (value: MerchantAiNoticeUpdate, moveFocus: boolean) => {
    void markSeen(value)
      .then(() => {
        setDismissed(`${value.noticeVersion}:${value.noticeDigest}`)
        if (moveFocus) requestAnimationFrame(() => focusAfterAiUpdate())
      })
      .catch(() => {
        /* The action reports the failure; the banner remains retryable. */
      })
  }
  return (
    <>
      {visible && (
        <UpdateBannerNotice
          update={update}
          pending={pending}
          trigger={trigger}
          onOpen={() => {
            setOpened(update)
            recordSeen(update, false)
          }}
          onSeen={() => recordSeen(update, true)}
        />
      )}
      <MerchantAiNoticeUpdateDialog
        update={opened}
        onClose={() => setOpened(null)}
        returnFocus={trigger}
      />
    </>
  )
}

function UpdateBannerNotice({
  update,
  pending,
  trigger,
  onOpen,
  onSeen,
}: Readonly<{
  update: MerchantAiNoticeUpdate
  pending: boolean
  trigger: RefObject<HTMLButtonElement | null>
  onOpen: () => void
  onSeen: () => void
}>) {
  return (
    <div className={cn('shrink-0 py-2', PAGE_GUTTER_X)}>
      <Alert variant="info">
        <AlertDescription>
          <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 text-foreground">
            <span className="min-w-0 flex-1 basis-64">{update.title}</span>
            <div className="flex items-center gap-2">
              <Button
                ref={trigger}
                variant="outline"
                size="sm"
                aria-haspopup="dialog"
                onClick={onOpen}
              >
                What changed
              </Button>
              <Button variant="ghost" size="sm" pending={pending} onClick={onSeen}>
                Got it
              </Button>
            </div>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  )
}
