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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { ReplySuggestionFixTarget } from './reply-suggestion-contract'
import type { ReplyTone } from './use-reply-suggestion'

type SuggestionMode = 'ai' | 'template'

type TemplateOption = Readonly<{ id: string; title: string }>

type Props = Readonly<{
  tone: ReplyTone
  primaryMode: SuggestionMode
  primaryExplanation: string
  disabled: boolean
  templateDisabled: boolean
  aiDisabled: boolean
  templateUnavailableReason: string | null
  aiUnavailableReason: string | null
  isGenerating: boolean
  isLoadingTemplate: boolean
  hasAiDraft: boolean
  canUndo: boolean
  aiError: string | null
  templateError: string | null
  errorFixTarget?: ReplySuggestionFixTarget | null
  propertyId: string
  templates: readonly TemplateOption[]
  onToneChange: (tone: ReplyTone) => void
  onRequestAi: (tone?: ReplyTone) => Promise<void>
  onPrepareTemplateMenu: () => void
  onLoadRecommended: () => Promise<void>
  onLoadTemplate: (templateId: string, title: string) => Promise<void>
  onLoadLocalSafe: () => Promise<void>
  onUndo: () => void
}>

const toneLabel: Record<ReplyTone, string> = {
  professional: 'Professional',
  friendly: 'Friendly',
  casual: 'Casual',
}

function AiControls(
  props: Pick<
    Props,
    | 'tone'
    | 'primaryMode'
    | 'disabled'
    | 'aiDisabled'
    | 'aiUnavailableReason'
    | 'isGenerating'
    | 'onToneChange'
    | 'onRequestAi'
  >,
) {
  const reasonId = useId()
  const disabled = props.disabled || props.aiDisabled
  return (
    <>
      <ButtonGroup>
        <Button
          type="button"
          size="sm"
          variant={props.primaryMode === 'ai' ? 'default' : 'outline'}
          disabled={disabled}
          aria-describedby={props.aiUnavailableReason ? reasonId : undefined}
          onClick={() => void props.onRequestAi()}
        >
          <Sparkles data-icon="inline-start" />
          {props.isGenerating ? 'Drafting…' : 'Draft with AI'}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant={props.primaryMode === 'ai' ? 'default' : 'outline'}
              disabled={disabled}
              aria-label={`AI tone: ${toneLabel[props.tone]}`}
              aria-describedby={props.aiUnavailableReason ? reasonId : undefined}
            >
              <ChevronDown data-icon="inline-start" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              {(Object.keys(toneLabel) as ReplyTone[]).map((option) => (
                <DropdownMenuItem
                  key={option}
                  onSelect={() => props.onToneChange(option)}
                >
                  {toneLabel[option]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      {props.aiUnavailableReason && (
        <span id={reasonId} className="sr-only">
          {props.aiUnavailableReason}
        </span>
      )}
    </>
  )
}

function TemplateControls(
  props: Pick<
    Props,
    | 'primaryMode'
    | 'disabled'
    | 'templateDisabled'
    | 'templateUnavailableReason'
    | 'isLoadingTemplate'
    | 'templates'
    | 'onPrepareTemplateMenu'
    | 'onLoadRecommended'
    | 'onLoadTemplate'
    | 'onLoadLocalSafe'
  >,
) {
  const reasonId = useId()
  const disabled = props.disabled || props.templateDisabled
  const variant = props.primaryMode === 'template' ? 'default' : 'outline'
  return (
    <>
      <ButtonGroup>
        <Button
          type="button"
          size="sm"
          variant={variant}
          disabled={disabled}
          aria-describedby={props.templateUnavailableReason ? reasonId : undefined}
          onClick={() => void props.onLoadRecommended()}
        >
          <ShieldCheck data-icon="inline-start" />
          {props.isLoadingTemplate ? 'Loading…' : 'Load template'}
        </Button>
        <DropdownMenu
          onOpenChange={(open) => {
            if (open) props.onPrepareTemplateMenu()
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant={variant}
              disabled={disabled}
              aria-label="Choose a reply template"
              aria-describedby={props.templateUnavailableReason ? reasonId : undefined}
            >
              <ChevronDown data-icon="inline-start" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              {props.templates.map((template) => (
                <DropdownMenuItem
                  key={template.id}
                  onSelect={() => void props.onLoadTemplate(template.id, template.title)}
                >
                  {template.title}
                </DropdownMenuItem>
              ))}
              {props.templates.length === 0 && (
                <DropdownMenuItem disabled>
                  {props.isLoadingTemplate
                    ? 'Loading property templates…'
                    : 'No library templates for this review'}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void props.onLoadLocalSafe()}>
                Local safe template
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      {props.templateUnavailableReason && (
        <span id={reasonId} className="sr-only">
          {props.templateUnavailableReason}
        </span>
      )}
    </>
  )
}

export function ReplySuggestionControls(props: Props) {
  const { can } = usePermissions()
  const canManagePortalBrand = can('portal.admin')
  const canManageAi = can('ai.manage')
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <TemplateControls {...props} />
      <AiControls {...props} />
      {props.hasAiDraft && (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.disabled || props.aiDisabled}
            onClick={() => void props.onRequestAi('friendly')}
          >
            Friendlier
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.disabled || props.aiDisabled}
            onClick={() => void props.onRequestAi()}
          >
            <RotateCcw data-icon="inline-start" /> Try again
          </Button>
        </>
      )}
      {props.canUndo && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={props.disabled}
          onClick={props.onUndo}
        >
          <Undo2 data-icon="inline-start" /> Undo
        </Button>
      )}
      <p className="basis-full text-xs text-muted-foreground">
        {props.primaryExplanation}
      </p>
      {(props.templateError || props.aiError) && (
        <div role="status" className="basis-full text-xs text-destructive">
          {props.templateError && <p>{props.templateError}</p>}
          {props.aiError && <p>{props.aiError}</p>}
          {props.errorFixTarget === 'public_display_name' &&
            (canManagePortalBrand ? (
              <Button asChild size="xs" variant="link">
                <Link
                  to="/properties/$propertyId/settings"
                  params={{ propertyId: props.propertyId }}
                >
                  Set the public display name
                </Link>
              </Button>
            ) : (
              <p>
                Ask an account admin to set this property&rsquo;s public display name.
              </p>
            ))}
          {props.errorFixTarget === 'ai_settings' &&
            (canManageAi ? (
              <Button asChild size="xs" variant="link">
                <Link to="/settings/ai" search={{ propertyId: props.propertyId }}>
                  Enable AI replies
                </Link>
              </Button>
            ) : (
              <p>Ask an account admin to enable AI reply drafting for this property.</p>
            ))}
        </div>
      )}
    </div>
  )
}
