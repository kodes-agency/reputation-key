import './reply-draft-waiting.css'
import { Sparkles } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import type { DraftSessionSnapshot } from './reply-draft-session'

const STEPS = {
  reading: 'Reading the review…',
  thinking: 'Thinking about what to say…',
  answering: 'Answering the highlighted sentences…',
  writing: 'Writing…',
  checking: 'Checking the wording…',
  rewording: 'Rewording one phrase…',
  done: '',
  refused: '',
  deferred: '',
}
export function draftStepText(state: DraftSessionSnapshot): string {
  if (state.slow)
    return 'Taking longer than usual. Keep waiting, press Stop, or use a template.'
  return STEPS[state.progress?.step ?? 'reading']
}
export function ReplyDraftWaiting({
  state,
  onStop,
  onTemplates,
}: Readonly<{
  state: DraftSessionSnapshot
  onStop: () => void
  onTemplates: () => void
}>) {
  return (
    <section aria-label="Draft suggestion" className="rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <Sparkles
          aria-hidden="true"
          className="size-4 animate-pulse text-primary motion-reduce:animate-none"
        />
        <span>Writing a reply</span>
        {!state.slow && (
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {state.progress?.step === 'rewording'
              ? 'a few more seconds'
              : 'about 5 seconds'}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {state.slow ? (
          <>
            Taking longer than usual. Keep waiting, press Stop, or{' '}
            <Button type="button" variant="link" size="inline" onClick={onTemplates}>
              use a template
            </Button>
            .
          </>
        ) : (
          draftStepText(state)
        )}
      </p>
      <div className="mt-3 space-y-3 whitespace-pre-wrap text-sm">
        {state.frame?.prefix && <p>{state.frame.prefix}</p>}
        {/* A div may not carry an `aria-label` without a role (axe
            `aria-prohibited-attr`); `img` is the role of a named placeholder. */}
        <Skeleton
          variant="reply-body"
          role="img"
          aria-label="Reply body is being written"
        />
        {state.frame?.suffix && <p>{state.frame.suffix}</p>}
      </div>
      <div className="mt-3">
        <Button type="button" size="sm" variant="ghost" onClick={onStop}>
          Stop
        </Button>
      </div>
    </section>
  )
}
