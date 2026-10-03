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
import { IconButton } from '#/components/ui/icon-button'

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
          // Blocked-with-a-reason is `aria-disabled`, not `disabled`: a natively
          // disabled button leaves the tab order and takes its
          // `aria-describedby` with it, so the one sentence saying why this
          // tool is unavailable could never be reached — the rule the Submit
          // primary (`reply-composer-footer.tsx`) and the reply actions follow.
          // `disabled` stays for an in-flight write, which has nothing to say,
          // and for a block that somehow arrives without its sentence.
          disabled={props.disabled || (props.aiDisabled && !props.aiUnavailableReason)}
          aria-disabled={props.aiDisabled || undefined}
          title={props.isPrimary ? props.primaryExplanation : undefined}
          aria-describedby={describedBy}
          onClick={() => {
            if (props.aiDisabled) return
            void props.onRequestAi()
          }}
        >
          <Sparkles aria-hidden="true" />
          <span className={ASSIST_LABEL_CLASS}>
            {props.isGenerating ? 'Drafting…' : 'Draft with AI'}
          </span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              type="button"
              size="icon-sm"
              variant="outline"
              disabled={props.disabled}
              label={`AI tone and language: ${TONE_LABEL[props.tone]}${languageName ? `, ${languageName}` : ''}`}
              aria-describedby={describedBy}
            >
              <ChevronDown aria-hidden="true" />
            </IconButton>
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
