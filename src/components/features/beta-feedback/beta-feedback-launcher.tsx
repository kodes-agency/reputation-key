import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
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
import { BETA_FEEDBACK_REPORTS_ANCHOR } from '#/contexts/feed/application/public-api'
import type { ListMyBetaFeedback, SubmitBetaFeedback } from './beta-feedback-form-context'

// The app shell mounts this launcher on every authenticated page, but nobody
// needs the form, the reports panel or TanStack Form until they open it. Split
// here keeps all of that out of the initial closure the bundle budget guards.
const BetaFeedbackDialogBody = lazy(() => import('./beta-feedback-dialog-body'))
// The unread-outcome marker is split for the same reason; it fetches the
// reporter's list once per app load and shares the reports panel's cache.
const BetaFeedbackUpdatesDot = lazy(() => import('./beta-feedback-updates-dot'))

type Props = Readonly<{
  submitFeedback: SubmitBetaFeedback
  listFeedback?: ListMyBetaFeedback
}>

function DialogBodyFallback() {
  return <div className="h-64 animate-pulse rounded-md bg-muted" aria-busy="true" />
}

/** Low-noise, manager-only entry point mounted by the authenticated app shell. */
export function BetaFeedbackLauncher({ submitFeedback, listFeedback }: Props) {
  const [open, setOpen] = useState(false)
  const [initialPanel, setInitialPanel] = useState<'report' | 'reports'>('report')
  // Bumped when the reports panel records what was seen, so the marker re-reads.
  const [seenVersion, setSeenVersion] = useState(0)
  const onReportsSeen = useCallback(() => setSeenVersion((version) => version + 1), [])

  // A report-outcome notification links here with this hash (ADR 0059): the
  // reports live in this dialog, not on a route. Opening is derived from the
  // fragment CHANGING, during render, so it needs no state-setting effect; the
  // previous value starts empty so a deep link that mounts the page opens too.
  const fragment = useRouterState({ select: (state) => state.location.hash })
  const [previousFragment, setPreviousFragment] = useState('')
  if (fragment !== previousFragment) {
    setPreviousFragment(fragment)
    if (fragment === BETA_FEEDBACK_REPORTS_ANCHOR && listFeedback) {
      setInitialPanel('reports')
      setOpen(true)
    }
  }
  // Then consume the fragment, so the same notification can open it again later.
  const navigate = useNavigate()
  useEffect(() => {
    if (fragment === BETA_FEEDBACK_REPORTS_ANCHOR) {
      void navigate({ to: '.', hash: '', replace: true })
    }
  }, [fragment, navigate])

  const onOpenChange = (next: boolean): void => {
    setOpen(next)
    // The next ordinary open starts where a reporter expects: on the form.
    if (!next) setInitialPanel('report')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {/*
          The accessible name is built from content rather than aria-label: it
          starts with the visible word "Feedback" (WCAG 2.5.3), and the
          code-split marker can append "— 1 report updated" without the
          launcher carrying that state.
        */}
        <Button type="button" variant="ghost" size="sm" className="relative gap-2">
          <MessageSquarePlus className="size-4" aria-hidden="true" />
          <span className="sr-only">Feedback: report a problem or share an idea</span>
          <span className="hidden sm:inline" aria-hidden="true">
            Feedback
          </span>
          {listFeedback && (
            <Suspense fallback={null}>
              <BetaFeedbackUpdatesDot
                listFeedback={listFeedback}
                seenVersion={seenVersion}
              />
            </Suspense>
          )}
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
              onReportsSeen={onReportsSeen}
              initialPanel={initialPanel}
            />
          </Suspense>
        </DialogContent>
      )}
    </Dialog>
  )
}
