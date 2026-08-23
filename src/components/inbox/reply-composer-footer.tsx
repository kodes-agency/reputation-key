import { CheckCircle2, LoaderCircle, Lock, TriangleAlert } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { ReplyAutosaveStatus } from './use-reply-autosave'

type Props = Readonly<{
  status: ReplyAutosaveStatus
  error: string | null
  languageName: string | null
  canSubmit: boolean
  disabled: boolean
  isSubmitting: boolean
  onRetrySave: () => Promise<void>
  onSubmit: () => Promise<void>
  onDelete?: () => Promise<unknown>
}>

function SaveState({ status }: Readonly<{ status: ReplyAutosaveStatus }>) {
  if (status === 'saving' || status === 'pending') {
    return (
      <span className="flex items-center gap-1.5">
        <LoaderCircle className="size-4 animate-spin" /> Saving draft…
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-destructive">
        <TriangleAlert className="size-4" /> Draft not saved
      </span>
    )
  }
  if (status === 'unsaved') return <span>Changes are not saved</span>
  return (
    <span className="flex items-center gap-1.5">
      <CheckCircle2 className="size-4" /> {status === 'saved' ? 'Saved' : 'Draft'}
    </span>
  )
}

export function ReplyComposerFooter({
  status,
  error,
  languageName,
  canSubmit,
  disabled,
  isSubmitting,
  onRetrySave,
  onSubmit,
  onDelete,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p aria-live="polite" className="mr-auto text-xs text-muted-foreground">
          <SaveState status={status} />
        </p>
        {status === 'error' && (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => void onRetrySave()}
          >
            Retry save
          </Button>
        )}
        {onDelete && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={onDelete}>
            Delete draft
          </Button>
        )}
        <Button
          size="sm"
          disabled={!canSubmit || disabled}
          onClick={() => void onSubmit()}
        >
          {isSubmitting ? 'Submitting…' : 'Submit for approval'}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        {languageName
          ? `Google will receive this reply in ${languageName}. Nothing is published automatically.`
          : 'Reply language is not configured. Nothing is published automatically.'}
      </p>
    </div>
  )
}
