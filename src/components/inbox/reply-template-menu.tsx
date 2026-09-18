import { useId } from 'react'
import { ChevronDown, ShieldCheck } from 'lucide-react'
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
  replyLanguageEntryText,
  replyLanguageMenuEntries,
  templateLanguageOptions,
  type ReplyLanguageMenuEntry,
} from './reply-assist-language'
import {
  ASSIST_LABEL_CLASS,
  AssistSectionLabel,
  MENU_COLLISION_PADDING_PX,
  PropertyLanguageMissingItem,
  SelectedMark,
} from './reply-assist-menu-parts'
import {
  languageDisplayName,
  type ReviewLanguageReadiness,
} from './reply-language-options'
import type { ReplyLanguageChoices } from './use-reply-composer'
import type { ReplyAssistScope } from './use-reply-suggestion'

type TemplateOption = Readonly<{ id: string; title: string }>

export type ReplyTemplateMenuProps = Readonly<{
  /** Whether a template is the recommended path for this review. */
  isPrimary: boolean
  /** Why the recommended path is recommended — the recommended control's tooltip. */
  primaryExplanation: string
  /** The composer is busy (saving, generating, adopting, loading a template). */
  disabled: boolean
  templateDisabled: boolean
  templateUnavailableReason: string | null
  isLoadingTemplate: boolean
  propertyId: string
  /** The library for the CURRENT language target (`useReplyTemplate().templates`). */
  templates: ReadonlyArray<TemplateOption>
  /**
   * The language group the server returned that library in
   * (`ReplyTemplateListResult.groups[0].languageGroup`), or `null` while none
   * is loaded. The list is named by THIS, not by the selection: a
   * `review_language` target falls back to the property default's templates
   * whenever the review's language is unrecorded
   * (`reply-template-operations.ts:82-93`), and naming that list after the
   * selection printed `Templates in Turkish` over Bulgarian templates.
   */
  templateLanguageTag: string | null
  /**
   * `useReplyComposer().languageChoices`: the options, the selected tag, and
   * `updateLanguage`, which returns the scope it committed.
   */
  languageChoices: ReplyLanguageChoices
  /** Selects which sentence explains a missing property default. */
  reviewLanguageReadiness: ReviewLanguageReadiness
  /**
   * `useReplyTemplate().prepareMenu`. Called bare when the menu opens (fetch
   * the list for the current target), and with the scope `updateLanguage`
   * returned when the switch changed the target in the same event.
   */
  onPrepareTemplateMenu: (scope?: Pick<ReplyAssistScope, 'target'>) => void
  onLoadRecommended: () => Promise<void>
  onLoadTemplate: (templateId: string, title: string) => Promise<void>
  onLoadLocalSafe: () => Promise<void>
}>

type SwitchProps = Readonly<{
  entries: ReadonlyArray<ReplyLanguageMenuEntry>
  onSwitch: (languageTag: string) => void
}>

/**
 * `Templates in` — the canvas's `.mseg`: a muted track with the languages
 * side by side, the selected one raised on the background with a check. A row
 * of segments rather than two more stacked rows, because stacked rows directly
 * above the template titles would read as two more templates; a track reads as
 * a filter on the list under it, which is what it is.
 *
 * They are still menu ITEMS (Radix roving focus: arrow keys walk the segments
 * and then the list, and typeahead keeps working), each with `aria-current`
 * and a name that carries the source — visible `Turkish`, accessible
 * `Turkish · review language` (the visible word leads the name, WCAG 2.5.3).
 * The same row height as every menu item below `md` (`max-md:min-h-11`).
 *
 * `onSelect` prevents Radix's close-on-select: the point of switching is to
 * watch the list below re-scope, so the menu stays open.
 */
function TemplateLanguageSwitch({ entries, onSwitch }: SwitchProps) {
  return (
    <div className="mx-2 mb-1 flex flex-wrap gap-0.5 rounded-md bg-muted p-0.5">
      {entries.map((entry) => (
        <DropdownMenuItem
          key={entry.tag}
          disabled={entry.disabledReason !== null}
          aria-current={entry.isSelected ? 'true' : undefined}
          aria-label={replyLanguageEntryText(entry)}
          className="flex-1 justify-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground aria-[current=true]:bg-background aria-[current=true]:text-foreground aria-[current=true]:shadow-xs max-md:min-h-11"
          onSelect={(event) => {
            event.preventDefault()
            if (!entry.isSelected) onSwitch(entry.tag)
          }}
        >
          {entry.isSelected && <SelectedMark className="size-3.5" />}
          {entry.name}
        </DropdownMenuItem>
      ))}
    </div>
  )
}

/**
 * `Template ▾` (plan v2.1 row 17). Top to bottom: the `Templates in` language
 * switch, the template list for that language, a separator, `Local safe
 * template`.
 *
 * The switch sits at the TOP because it scopes what follows. Templates are
 * per-language — the library is filtered by the target's `templateGroup`
 * (`reply-template-operations.ts:137`) and a loaded template stamps its
 * language on the draft (`:304`) — so switching calls `updateLanguage` and
 * then `onPrepareTemplateMenu` with the scope it returned, and the list reloads
 * for the new language while the menu is still open. The scope is passed
 * rather than read from the next render because `updateLanguage` only
 * schedules its state: `prepareMenu` called bare in the same handler would
 * still fetch for the language just left (`use-reply-template.ts`, the
 * target-change effect and `prepareMenu`).
 *
 * The switch offers only languages the LIBRARY can be filtered by
 * (`templateLanguageOptions`): the property default and a review language the
 * server recorded. This comment used to claim the reload kept a Bulgarian
 * template off a draft tagged Turkish; it did not. The server resolves a
 * `review_language` target from the review's recorded language and falls back
 * to the property default otherwise (`reply-template-operations.ts:82-93`), the
 * review's language is never recorded, and so `Turkish` (detected by an AI
 * draft) and `Detect automatically` both listed the Bulgarian templates — the
 * latter while silently stopping autosave and Submit. Below two such languages
 * there is nothing to switch between and the switch is not drawn; the list is
 * then headed by the language the server actually returned it in.
 *
 * During the reload the list for the new target is empty and
 * `isLoadingTemplate` is true, so the existing loading row shows; an empty
 * library keeps the existing empty row.
 *
 * The chevron is disabled only while the composer is busy, never by
 * `templateDisabled`: "Choose a supported reply language before loading a
 * template" (`reply-editor-compose.tsx`) is fixed from inside this menu.
 */
export function ReplyTemplateMenu(props: ReplyTemplateMenuProps) {
  const reasonId = useId()
  const switchLabelId = useId()
  const listLabelId = useId()
  const { languageChoices } = props
  const entries = replyLanguageMenuEntries(
    templateLanguageOptions(
      languageChoices.options,
      languageChoices.isReviewLanguageRecorded,
    ),
    languageChoices.selectedTag,
  )
  const hasSwitch = entries.length > 1
  const listLanguage = languageDisplayName(props.templateLanguageTag)
  const listName = listLanguage ? `Templates in ${listLanguage}` : 'Templates'
  const describedBy = props.templateUnavailableReason ? reasonId : undefined
  const switchLanguage = (languageTag: string) =>
    props.onPrepareTemplateMenu(languageChoices.updateLanguage(languageTag))

  return (
    <>
      <ButtonGroup>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={`${CASE_SQUARE_CLASS} aria-disabled:opacity-50`}
          // Blocked-with-a-reason is `aria-disabled`, not `disabled`: a natively
          // disabled button leaves the tab order and takes its
          // `aria-describedby` with it, so the one sentence saying why this
          // tool is unavailable could never be reached — the rule the Submit
          // primary (`reply-composer-footer.tsx`) and the reply actions follow.
          // `disabled` stays for an in-flight write, which has nothing to say,
          // and for a block that somehow arrives without its sentence.
          disabled={
            props.disabled || (props.templateDisabled && !props.templateUnavailableReason)
          }
          aria-disabled={props.templateDisabled || undefined}
          title={props.isPrimary ? props.primaryExplanation : undefined}
          aria-describedby={describedBy}
          onClick={() => {
            if (props.templateDisabled) return
            void props.onLoadRecommended()
          }}
        >
          <ShieldCheck data-icon="inline-start" aria-hidden="true" />
          <span className={ASSIST_LABEL_CLASS}>
            {props.isLoadingTemplate ? 'Loading…' : 'Template'}
          </span>
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
              variant="outline"
              className="max-md:size-9"
              disabled={props.disabled}
              aria-label="Choose a reply template"
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
            {hasSwitch && (
              <DropdownMenuGroup aria-labelledby={switchLabelId}>
                <AssistSectionLabel id={switchLabelId}>Templates in</AssistSectionLabel>
                <TemplateLanguageSwitch entries={entries} onSwitch={switchLanguage} />
              </DropdownMenuGroup>
            )}
            {!hasPropertyDefaultOption(languageChoices.options) && (
              <PropertyLanguageMissingItem
                propertyId={props.propertyId}
                reviewLanguageReadiness={props.reviewLanguageReadiness}
                isAutoDetecting={languageChoices.isAutoDetecting}
              />
            )}
            <DropdownMenuGroup aria-label={listName}>
              {/* Without a switch the list says its language in words: the
                  heading is the one place in the menu that names it. */}
              {!hasSwitch && listLanguage !== null && (
                <AssistSectionLabel id={listLabelId}>{listName}</AssistSectionLabel>
              )}
              {props.templates.map((template) => (
                <DropdownMenuItem
                  key={template.id}
                  className="max-md:min-h-11"
                  onSelect={() => void props.onLoadTemplate(template.id, template.title)}
                >
                  {template.title}
                </DropdownMenuItem>
              ))}
              {props.templates.length === 0 && (
                <DropdownMenuItem disabled className="max-md:min-h-11">
                  {props.isLoadingTemplate
                    ? 'Loading property templates…'
                    : 'No library templates for this review'}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="max-md:min-h-11"
              onSelect={() => void props.onLoadLocalSafe()}
            >
              Local safe template
            </DropdownMenuItem>
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
