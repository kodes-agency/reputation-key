import { Link } from '@tanstack/react-router'
import { FileText, RotateCcw, Undo2 } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { ReplyAiMenu, type ReplyAiMenuProps } from './reply-ai-menu'
import type { ReplySuggestionFixTarget } from './reply-suggestion-contract'
import { ReplyTemplateMenu, type ReplyTemplateMenuProps } from './reply-template-menu'
import { useRetryCountdown } from './use-retry-countdown'

type SuggestionMode = 'ai' | 'template'

/**
 * Everything the two menus take, minus `isPrimary` (derived here from
 * `primaryMode`), plus what this row owns itself: the order, `Undo`, and the
 * error line with its fix. The props the menus share — `disabled`,
 * `propertyId`, `primaryExplanation`, `languageChoices` and
 * `reviewLanguageReadiness` — have one type in both menus, so one value feeds
 * them both.
 */
type Props = Omit<ReplyAiMenuProps & ReplyTemplateMenuProps, 'isPrimary'> &
  Readonly<{
    primaryMode: SuggestionMode
    canUndo: boolean
    hasAiDraft: boolean
    aiError: string | null
    /** Our own AI capacity is busy until this instant (`use-reply-suggestion.ts`). */
    aiBusyUntil: number | null
    /** The refusal leaves the governed template as an explicit alternative. */
    aiOffersTemplate: boolean
    onUseTemplateInstead: () => void
    templateError: string | null
    errorFixTarget?: ReplySuggestionFixTarget | null
    onUndo: () => void
  }>

/*
 * The dock's assist tools (plan v2.1 row 14, the foot row's left half).
 *
 * This file used to BE both split buttons, at 294 of 300 counted lines, and
 * could not take the language when row 17 moved it out of the composer chrome
 * and into the menus. It split along the seam the plan names: `Draft with AI ▾`
 * is `reply-ai-menu.tsx`, `Template ▾` is `reply-template-menu.tsx`, and the
 * words both print are `reply-assist-language.ts` / `reply-assist-menu-parts.tsx`.
 * What stays here is what is about the ROW, not either tool: which tool comes
 * first, the one-click actions for an adopted AI draft, `Undo`, and the error
 * line with its fix target. Language remains inside the two assist menus; it
 * is not repeated as a separate control beside them.
 *
 * Mobile (row 20): 36 px, not v1's 44. WCAG 2.5.8 AA asks for 24 px, and 44 on
 * every half of two split buttons is what turned the phone's composer into a
 * block of large buttons (plan finding 6). `max-md:h-9` on `Undo` (a `size="sm"`
 * button), `max-md:min-h-9` on the link-styled fix buttons, which wrap rather
 * than sit on one line; menu ITEMS inside the two menus keep `max-md:min-h-11`
 * — stacked edge to edge with no gap, they are a different target class. `max-md:`,
 * not unconditional: the desktop pane is dense on purpose.
 */
export function ReplySuggestionControls(props: Props) {
  const { can } = usePermissions()
  const canManagePortalBrand = can('portal.admin')
  const canManageAi = can('ai.manage')
  // The recommended path leads. `primaryMode` is `template` whenever the review
  // has no detectable language (`reply-editor-compose.tsx`, `usesTemplatePath`),
  // where AI drafting cannot verify its output's language anyway.
  const ai = <ReplyAiMenu key="ai" {...props} isPrimary={props.primaryMode === 'ai'} />
  const template = (
    <ReplyTemplateMenu
      key="template"
      {...props}
      isPrimary={props.primaryMode === 'template'}
    />
  )

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      {props.primaryMode === 'ai' ? [ai, template] : [template, ai]}
      {props.hasAiDraft && (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="max-md:h-9"
            disabled={props.disabled || props.aiDisabled}
            onClick={() => void props.onRequestAi('friendly')}
          >
            Friendlier
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="max-md:h-9"
            disabled={props.disabled || props.aiDisabled}
            onClick={() => void props.onRequestAi()}
          >
            <RotateCcw data-icon="inline-start" aria-hidden="true" /> Try again
          </Button>
        </>
      )}
      {props.canUndo && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="max-md:h-9"
          disabled={props.disabled}
          onClick={props.onUndo}
        >
          <Undo2 data-icon="inline-start" /> Undo
        </Button>
      )}
      {(props.templateError || props.aiError) && (
        <div
          role="status"
          className={cn(
            'basis-full text-xs',
            // Busy is our own capacity, not a failure: it reads as a wait.
            props.aiBusyUntil !== null && !props.templateError
              ? 'text-muted-foreground'
              : 'text-destructive',
          )}
        >
          {props.templateError && <p>{props.templateError}</p>}
          {props.aiError && <p>{props.aiError}</p>}
          {(props.aiBusyUntil !== null || props.aiOffersTemplate) && (
            // A refusal is never answered with a substitute: the manager
            // chooses between waiting for AI and the governed template.
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {props.aiBusyUntil !== null && (
                <RetryAfterButton
                  key={props.aiBusyUntil}
                  retryAtEpochMillis={props.aiBusyUntil}
                  disabled={props.disabled || props.aiDisabled}
                  onRetry={() => void props.onRequestAi()}
                />
              )}
              {props.aiOffersTemplate && (
                <Button
                  type="button"
                  size="xs"
                  variant="link"
                  className="px-0 max-md:min-h-9"
                  disabled={props.disabled}
                  onClick={props.onUseTemplateInstead}
                >
                  <FileText data-icon="inline-start" aria-hidden="true" />
                  Use a template instead
                </Button>
              )}
            </div>
          )}
          {props.errorFixTarget === 'public_display_name' &&
            (canManagePortalBrand ? (
              <Button asChild size="xs" variant="link" className="max-md:min-h-9">
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
              <Button asChild size="xs" variant="link" className="max-md:min-h-9">
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

function RetryAfterButton(
  props: Readonly<{
    retryAtEpochMillis: number
    disabled: boolean
    onRetry: () => void
  }>,
) {
  const seconds = useRetryCountdown(props.retryAtEpochMillis)
  return (
    <Button
      type="button"
      size="xs"
      variant="link"
      className="px-0 max-md:min-h-9"
      disabled={props.disabled || seconds > 0}
      onClick={props.onRetry}
    >
      <RotateCcw data-icon="inline-start" aria-hidden="true" />
      {seconds > 0 ? (
        <span>
          Try again in <span className="tabular-nums">{seconds}s</span>
        </span>
      ) : (
        'Try again'
      )}
    </Button>
  )
}
