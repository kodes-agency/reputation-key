import { ChevronDown, RotateCcw, Sparkles, Undo2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { ButtonGroup } from '#/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { ReplyTone } from './use-reply-suggestion'

type Props = Readonly<{
  tone: ReplyTone
  disabled: boolean
  isGenerating: boolean
  hasAiDraft: boolean
  canUndo: boolean
  error: string | null
  onToneChange: (tone: ReplyTone) => void
  onRequest: (tone?: ReplyTone) => Promise<void>
  onUndo: () => void
}>

const toneLabel: Record<ReplyTone, string> = {
  professional: 'Professional',
  friendly: 'Friendly',
  casual: 'Casual',
}

export function ReplySuggestionControls({
  tone,
  disabled,
  isGenerating,
  hasAiDraft,
  canUndo,
  error,
  onToneChange,
  onRequest,
  onUndo,
}: Props) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <ButtonGroup>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => void onRequest()}
        >
          <Sparkles />
          {isGenerating ? 'Drafting…' : 'Draft with AI'}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              disabled={disabled}
              aria-label={`AI tone: ${toneLabel[tone]}`}
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(Object.keys(toneLabel) as ReplyTone[]).map((option) => (
              <DropdownMenuItem key={option} onSelect={() => onToneChange(option)}>
                {toneLabel[option]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>

      {hasAiDraft && (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => void onRequest('friendly')}
          >
            Friendlier
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => void onRequest()}
          >
            <RotateCcw /> Try again
          </Button>
        </>
      )}
      {canUndo && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={onUndo}
        >
          <Undo2 /> Undo
        </Button>
      )}
      {error && (
        <p role="status" className="basis-full text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
