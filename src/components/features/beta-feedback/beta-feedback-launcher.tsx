import { lazy, Suspense, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Skeleton } from '#/components/ui/skeleton'
import type { ListMyBetaFeedback, SubmitBetaFeedback } from './beta-feedback-form-context'

// The app shell mounts this launcher on every authenticated page, but nobody
// needs the form, the reports panel or TanStack Form until they open it. Split
// here keeps all of that out of the initial closure the bundle budget guards.
const BetaFeedbackDialogBody = lazy(() => import('./beta-feedback-dialog-body'))

type Props = Readonly<{
  submitFeedback: SubmitBetaFeedback
  listFeedback?: ListMyBetaFeedback
}>

function DialogBodyFallback() {
  return (
    <div className="space-y-3 py-2" aria-busy="true">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  )
}

/** Low-noise, manager-only entry point mounted by the authenticated app shell. */
export function BetaFeedbackLauncher({ submitFeedback, listFeedback }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2"
          aria-label="Report a problem or share an idea"
        >
          <MessageSquarePlus className="size-4" />
          <span className="hidden sm:inline">Feedback</span>
        </Button>
      </DialogTrigger>
      {open && (
        <DialogContent
          className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl"
          data-beta-feedback-capture-exclude
        >
          <DialogHeader>
            <DialogTitle>Help shape RepKey</DialogTitle>
            <DialogDescription>
              Tell us what broke or what would work better. You&apos;ll get a reference,
              and you can follow what happens to it.
            </DialogDescription>
          </DialogHeader>
          <Suspense fallback={<DialogBodyFallback />}>
            <BetaFeedbackDialogBody
              submitFeedback={submitFeedback}
              listFeedback={listFeedback}
            />
          </Suspense>
        </DialogContent>
      )}
    </Dialog>
  )
}
