import { useState } from 'react'
import {
  Bug,
  CheckCircle2,
  Lightbulb,
  MessageSquarePlus,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { type SubmitBetaFeedback } from './beta-feedback-form-context'
import { BugFeedbackForm } from './beta-feedback-forms'
import { SuggestionFeedbackForm } from './suggestion-feedback-form'

type Props = Readonly<{
  submitFeedback: SubmitBetaFeedback
}>

function PrivacyNotice() {
  return (
    <div className="flex gap-3 rounded-lg border bg-muted/35 p-3 text-sm">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1 text-muted-foreground">
        <p>
          Only the text you enter, controlled diagnostic categories, and an opaque receipt
          are sent. Suggestions are always text-only. A Bug can include a text-free masked
          layout only after you explicitly create, preview, and keep it.
        </p>
        <p>
          Please don&apos;t include guest names, review text, contact details, passwords,
          or access codes. RepKey never records a replay or ordinary pixel screenshot.
        </p>
      </div>
    </div>
  )
}

function FeedbackReceipt({ reference }: Readonly<{ reference: string }>) {
  return (
    <div className="space-y-5 py-2" aria-live="polite">
      <div className="flex gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 className="size-5" />
        </div>
        <div className="space-y-1">
          <h3 className="font-medium">Thanks — we received it</h3>
          <p className="text-sm text-muted-foreground">
            Your report is available to the RepKey beta team. It does not create a public
            issue.
          </p>
        </div>
      </div>
      <div className="rounded-md border bg-muted/35 px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">Reference</p>
        <p className="mt-1 break-all font-mono text-sm">{reference}</p>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button>Done</Button>
        </DialogClose>
      </DialogFooter>
    </div>
  )
}

function FeedbackDialogBody({ submitFeedback }: Props) {
  const [reference, setReference] = useState<string | null>(null)

  if (reference) return <FeedbackReceipt reference={reference} />

  return (
    <>
      <PrivacyNotice />
      <Tabs defaultValue="bug">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="bug">
            <Bug />
            Report a bug
          </TabsTrigger>
          <TabsTrigger value="suggestion">
            <Lightbulb />
            Make a suggestion
          </TabsTrigger>
        </TabsList>
        <TabsContent value="bug" className="mt-3">
          <BugFeedbackForm submitFeedback={submitFeedback} onSubmitted={setReference} />
        </TabsContent>
        <TabsContent value="suggestion" className="mt-3">
          <SuggestionFeedbackForm
            submitFeedback={submitFeedback}
            onSubmitted={setReference}
          />
        </TabsContent>
      </Tabs>
    </>
  )
}

/** Low-noise, manager-only entry point mounted by the authenticated app shell. */
export function BetaFeedbackLauncher({ submitFeedback }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2"
          aria-label="Send beta feedback"
        >
          <MessageSquarePlus className="size-4" />
          <span className="hidden sm:inline">Beta feedback</span>
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
              Report a problem or suggest an improvement. You&apos;ll receive a reference
              after it is sent.
            </DialogDescription>
          </DialogHeader>
          <FeedbackDialogBody submitFeedback={submitFeedback} />
        </DialogContent>
      )}
    </Dialog>
  )
}
