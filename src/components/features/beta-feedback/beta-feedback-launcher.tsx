import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus, ShieldCheck } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { identityKeys } from '#/shared/queries/query-keys'
import type { ListMyBetaFeedback, SubmitBetaFeedback } from './beta-feedback-form-context'
import { BetaFeedbackForm } from './beta-feedback-form'
import { BetaFeedbackReceipt } from './beta-feedback-receipt'
import { BetaFeedbackReports } from './beta-feedback-reports'

type Props = Readonly<{
  submitFeedback: SubmitBetaFeedback
  listFeedback?: ListMyBetaFeedback
}>

type Panel = 'report' | 'reports'

function PrivacyNotice() {
  return (
    <div className="flex gap-3 rounded-lg border bg-muted/35 p-3 text-sm">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1 text-muted-foreground">
        <p>
          Only the text you enter, controlled diagnostic categories, and an opaque receipt
          are sent.
        </p>
        <p>
          Please don&apos;t include guest names, review text, contact details, passwords,
          or access codes. RepKey never records a replay or screenshot.
        </p>
      </div>
    </div>
  )
}

function FeedbackDialogBody({ submitFeedback, listFeedback }: Props) {
  const [reference, setReference] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>('report')
  const queryClient = useQueryClient()

  const onSubmitted = (submittedReference: string): void => {
    setReference(submittedReference)
    // The new report belongs in the history the next tab opens on.
    void queryClient.invalidateQueries({ queryKey: identityKeys.myBetaFeedback() })
  }

  const reportPanel = reference ? (
    <BetaFeedbackReceipt
      reference={reference}
      onTrackReports={() => {
        setReference(null)
        setPanel('reports')
      }}
      onReportAnother={() => setReference(null)}
    />
  ) : (
    <>
      <PrivacyNotice />
      <BetaFeedbackForm submitFeedback={submitFeedback} onSubmitted={onSubmitted} />
    </>
  )

  // Without a list seam there is no second panel to switch to.
  if (!listFeedback) return reportPanel

  return (
    <Tabs value={panel} onValueChange={(value) => setPanel(value as Panel)}>
      <TabsList className="w-full">
        <TabsTrigger value="report" className="flex-1">
          Report
        </TabsTrigger>
        <TabsTrigger value="reports" className="flex-1">
          Your reports
        </TabsTrigger>
      </TabsList>
      <TabsContent value="report" className="mt-4 space-y-5">
        {reportPanel}
      </TabsContent>
      <TabsContent value="reports" className="mt-4">
        <BetaFeedbackReports listFeedback={listFeedback} enabled={panel === 'reports'} />
      </TabsContent>
    </Tabs>
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
          <FeedbackDialogBody
            submitFeedback={submitFeedback}
            listFeedback={listFeedback}
          />
        </DialogContent>
      )}
    </Dialog>
  )
}
