import { useId } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'
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
import { CASE_SQUARE_CLASS } from './inbox-case-member'
import {
  hasPropertyDefaultOption,
  replyLanguageMenuEntries,
  selectedReplyLanguageName,
} from './reply-assist-language'
import {
  ASSIST_LABEL_CLASS,
  AssistSectionLabel,
  LanguageRow,
  MENU_COLLISION_PADDING_PX,
  PropertyLanguageMissingItem,
  SelectedMark,
} from './reply-assist-menu-parts'
import type { ReviewLanguageReadiness } from './reply-language-options'
import type { ReplyLanguageChoices } from './use-reply-composer'
import type { ReplyTone } from './use-reply-suggestion'

export type ReplyAiMenuProps = Readonly<{
  tone: ReplyTone
  /** Whether AI drafting is the recommended path for this review. */
  isPrimary: boolean
  /**
   * Why the recommended path is recommended — the recommended control's
   * tooltip (v1 row 8: no longer printed as prose in the resting composer).
   */
  primaryExplanation: string
  /** The composer is busy (saving, generating, adopting, loading a template). */
  disabled: boolean
  aiDisabled: boolean
  aiUnavailableReason: string | null
  isGenerating: boolean
  propertyId: string
  /**
   * `useReplyComposer().languageChoices`: the options, the selected tag, and
   * `updateLanguage`, which returns the scope it committed.
   */
  languageChoices: ReplyLanguageChoices
  /** Selects which sentence explains a missing property default. */
  reviewLanguageReadiness: ReviewLanguageReadiness
  onToneChange: (tone: ReplyTone) => void
  onRequestAi: (tone?: ReplyTone) => Promise<void>
}>

const TONE_LABEL: Readonly<Record<ReplyTone, string>> = {
  professional: 'Professional',
  friendly: 'Friendly',
  casual: 'Casual',
}

const TONES = Object.keys(TONE_LABEL) as ReadonlyArray<ReplyTone>

/**
 * Below `md` both halves of the split button are 36 px (row 20): the primary
 * collapses to its sparkle in `CASE_SQUARE_CLASS`'s square — the case
 * toolbar's control geometry, reused so the dock and the toolbar cannot drift
 * — and the chevron grows from `icon-sm`'s 32 to 36 in both axes.
 */
const CHEVRON_CLASS = 'max-md:size-9'

/**
 * `Draft with AI ▾` (plan v2.1 row 17). The dropdown holds everything the
 * draft is made WITH: the `Tone` group, then — below a separator — the
 * `Write in` group, one row per `ReplyLanguageOption`. The language used to be
 * a select of its own in the composer chrome (`reply-language-select.tsx`);
 * it moved here because the server reads it only for the two assist actions —
 * see `reply-assist-language.ts` for the file:line evidence. The rows are
 * `LanguageRow`, shared with the template menu's language switch.
 *
 * The CHEVRON is disabled only while the composer is busy, never by
 * `aiDisabled`. One of the reasons AI drafting is unavailable is "Choose a
 * supported reply language before drafting with AI"
 * (`reply-editor-compose.tsx`, `aiUnavailableReason`), and the language is now
 * inside this menu: a chevron disabled by that reason would lock the only door
 * to its fix. The primary half carries `aiDisabled` and its reason.
 */
export function ReplyAiMenu(props: ReplyAiMenuProps) {
  const reasonId = useId()
  const toneLabelId = useId()
  const writeInLabelId = useId()
  const { languageChoices } = props
  const entries = replyLanguageMenuEntries(
    languageChoices.options,
    languageChoices.selectedTag,
  )
  const languageName = selectedReplyLanguageName(entries)
  const describedBy = props.aiUnavailableReason ? reasonId : undefined

  return (
    <>
      <ButtonGroup>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={CASE_SQUARE_CLASS}
          disabled={props.disabled || props.aiDisabled}
          title={props.isPrimary ? props.primaryExplanation : undefined}
          aria-describedby={describedBy}
          onClick={() => void props.onRequestAi()}
        >
          <Sparkles data-icon="inline-start" aria-hidden="true" />
          <span className={ASSIST_LABEL_CLASS}>
            {props.isGenerating ? 'Drafting…' : 'Draft with AI'}
          </span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className={CHEVRON_CLASS}
              disabled={props.disabled}
              aria-label={`AI tone and language: ${TONE_LABEL[props.tone]}${languageName ? `, ${languageName}` : ''}`}
              aria-describedby={describedBy}
            >
              <ChevronDown data-icon="inline-start" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            collisionPadding={MENU_COLLISION_PADDING_PX}
            className="w-72 max-w-[calc(100vw-1rem)]"
          >
            <DropdownMenuGroup aria-labelledby={toneLabelId}>
              <AssistSectionLabel id={toneLabelId}>Tone</AssistSectionLabel>
              {TONES.map((tone) => (
                <DropdownMenuItem
                  key={tone}
                  aria-current={tone === props.tone ? 'true' : undefined}
                  className="max-md:min-h-11"
                  onSelect={() => props.onToneChange(tone)}
                >
                  {TONE_LABEL[tone]}
                  {tone === props.tone && <SelectedMark className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup aria-labelledby={writeInLabelId}>
              <AssistSectionLabel id={writeInLabelId}>Write in</AssistSectionLabel>
              {entries.map((entry) => (
                <LanguageRow
                  key={entry.tag}
                  entry={entry}
                  updateLanguage={languageChoices.updateLanguage}
                />
              ))}
              {!hasPropertyDefaultOption(languageChoices.options) && (
                <PropertyLanguageMissingItem
                  propertyId={props.propertyId}
                  reviewLanguageReadiness={props.reviewLanguageReadiness}
                  isAutoDetecting={languageChoices.isAutoDetecting}
                />
              )}
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
