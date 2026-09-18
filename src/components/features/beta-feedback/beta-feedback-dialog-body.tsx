import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { identityKeys } from '#/shared/queries/query-keys'
import type { ListMyBetaFeedback, SubmitBetaFeedback } from './beta-feedback-form-context'
import { BetaFeedbackForm } from './beta-feedback-form'
import { BetaFeedbackReceipt } from './beta-feedback-receipt'
import { BetaFeedbackReports } from './beta-feedback-reports'

type Props = Readonly<{
  submitFeedback: SubmitBetaFeedback
  listFeedback?: ListMyBetaFeedback
  onReportsSeen?: () => void
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

/**
 * Everything behind the launcher, in its own module so the app shell does not
 * carry the form, the reports panel or their dependencies in the initial
 * closure. Nobody loads this until they open the dialog.
 */
function BetaFeedbackDialogBody({ submitFeedback, listFeedback, onReportsSeen }: Props) {
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
        <BetaFeedbackReports
          listFeedback={listFeedback}
          enabled={panel === 'reports'}
          onSeen={onReportsSeen}
        />
      </TabsContent>
    </Tabs>
  )
}

// Default export because React.lazy requires one; this module has no other
// caller, so a named export beside it would only be dead surface.
export default BetaFeedbackDialogBody
