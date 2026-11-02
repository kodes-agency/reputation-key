import { Button } from '#/components/ui/button'
import { InlineLink } from '#/components/ui/inline-link'
import { Dialog, DialogContent, DialogTitle } from '#/components/ui/dialog'
import { FormErrorBanner } from '#/components/forms/form-error-banner'

type Props = Readonly<{ pending: boolean; error: unknown; onAccept: () => void }>

export function StaffNotice(props: Props) {
  return (
    <Dialog open>
      <DialogContent
        presentation="screen"
        showCloseButton={false}
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <StaffNoticeContent {...props} />
      </DialogContent>
    </Dialog>
  )
}

export function StaffNoticeContent({ pending, error, onAccept }: Props) {
  return (
    <section className="my-auto py-8">
      <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6">
        <DialogTitle asChild>
          <h1 className="text-xl font-semibold">Before you start</h1>
        </DialogTitle>
        <p>
          Offer your code to every guest, not only those who seem happy. Never ask for a
          good rating, or for a guest to mention you.
        </p>
        <p>
          You aren't rewarded for high ratings. Your manager looks at ratings and scans
          together, so a high rating from very few guests may prompt a chat.
        </p>
        <p>
          Your manager can also see your notes and Google visits. Staff here may see your
          scan count.
        </p>
        <FormErrorBanner error={error} />
        <Button pending={pending} pendingLabel="Saving…" onClick={onAccept}>
          Got it
        </Button>
        <InlineLink to="/privacy">Privacy Notice</InlineLink>
      </div>
    </section>
  )
}
