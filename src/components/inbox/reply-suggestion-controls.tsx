import { useId } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, RotateCcw, ShieldCheck, Sparkles, Undo2 } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import { ButtonGroup } from '#/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { ReplySuggestionFixTarget } from './reply-suggestion-contract'
import type { ReplyTone } from './use-reply-suggestion'
type SuggestionMode = 'ai' | 'template'

type Props = Readonly<{
  tone: ReplyTone
  mode: SuggestionMode
  disabled: boolean
  unavailableReason: string | null
  isGenerating: boolean
  hasAiDraft: boolean
  canUndo: boolean
  error: string | null
  /** A refusal the operator can clear; renders the screen that clears it. */
  errorFixTarget?: ReplySuggestionFixTarget | null
  propertyId: string
  onToneChange: (tone: ReplyTone) => void
  onRequest: (tone?: ReplyTone) => Promise<void>
  onUndo: () => void
}>

const toneLabel: Record<ReplyTone, string> = {
  professional: 'Professional',
  friendly: 'Friendly',
  casual: 'Casual',
}

const modeCopy = {
  ai: { action: 'Draft with AI', pending: 'Drafting…', tone: 'AI' },
  template: { action: 'Load template', pending: 'Loading…', tone: 'Template' },
} satisfies Record<
  SuggestionMode,
  Readonly<{ action: string; pending: string; tone: string }>
>

function ReplySuggestionRequestButton({
  mode,
  disabled,
  describedBy,
  isGenerating,
  onRequest,
}: Readonly<{
  mode: SuggestionMode
  disabled: boolean
  describedBy: string | undefined
  isGenerating: boolean
  onRequest: () => void
}>) {
  const Icon = mode === 'template' ? ShieldCheck : Sparkles
  const copy = modeCopy[mode]
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled}
      aria-describedby={describedBy}
      onClick={onRequest}
    >
      <Icon data-icon="inline-start" />
      {isGenerating ? copy.pending : copy.action}
    </Button>
  )
}

export function ReplySuggestionControls({
  tone,
  mode,
  disabled,
  unavailableReason,
  isGenerating,
  hasAiDraft,
  canUndo,
  error,
  errorFixTarget = null,
  propertyId,
  onToneChange,
  onRequest,
  onUndo,
}: Props) {
  const unavailableReasonId = useId()
  const { can } = usePermissions()
  const canManagePortalBrand = can('portal.admin')
  const canManageAi = can('ai.manage')
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <ButtonGroup>
        <ReplySuggestionRequestButton
          mode={mode}
          disabled={disabled}
          describedBy={unavailableReason ? unavailableReasonId : undefined}
          isGenerating={isGenerating}
          onRequest={() => void onRequest()}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              disabled={disabled}
              aria-label={`${modeCopy[mode].tone} tone: ${toneLabel[tone]}`}
              aria-describedby={unavailableReason ? unavailableReasonId : undefined}
            >
              <ChevronDown data-icon="inline-start" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              {(Object.keys(toneLabel) as ReplyTone[]).map((option) => (
                <DropdownMenuItem key={option} onSelect={() => onToneChange(option)}>
                  {toneLabel[option]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
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
            <RotateCcw data-icon="inline-start" /> Try again
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
          <Undo2 data-icon="inline-start" /> Undo
        </Button>
      )}
      {error && (
        <div role="status" className="basis-full text-xs text-destructive">
          <p>{error}</p>
          {errorFixTarget === 'public_display_name' &&
            (canManagePortalBrand ? (
              <Button asChild size="xs" variant="link">
                <Link to="/properties/$propertyId/settings" params={{ propertyId }}>
                  Set the public display name
                </Link>
              </Button>
            ) : (
              <p>
                Ask an account admin to set this property&rsquo;s public display name.
              </p>
            ))}
          {errorFixTarget === 'ai_settings' &&
            (canManageAi ? (
              <Button asChild size="xs" variant="link">
                <Link to="/settings/ai" search={{ propertyId }}>
                  Enable AI replies
                </Link>
              </Button>
            ) : (
              <p>Ask an account admin to enable AI replies for this property.</p>
            ))}
        </div>
      )}
      {!error && unavailableReason && (
        <p
          id={unavailableReasonId}
          role="status"
          className="basis-full text-xs text-muted-foreground"
        >
          {unavailableReason}
        </p>
      )}
    </div>
  )
}
