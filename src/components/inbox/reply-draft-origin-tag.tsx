import { ChevronDown, Globe2, ShieldCheck, Sparkles } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { MENU_COLLISION_PADDING_PX } from './reply-assist-menu-parts'
import { replyLanguageMenuEntries } from './reply-assist-language'
import type { ReplyDraftOrigin } from './reply-draft-origin'
import {
  regenerateChoices,
  replyDraftOriginParts,
  type ReplyDraftOriginParts,
} from './reply-draft-origin-view'
import type { ReplyLanguageChoices } from './use-reply-composer'

type Props = Readonly<{
  origin: ReplyDraftOrigin
  languageChoices: ReplyLanguageChoices
  /**
   * Whether an AI request can run at all: a generator is wired and the review
   * has enough text for the governed language check. The composer's own
   * `aiUnavailableReason` is NOT reused — one of its reasons is "choose a
   * supported reply language", which a regenerate row answers itself by
   * naming the language it acts in.
   */
  canRegenerate: boolean
  /** The composer is busy (saving, generating, adopting, loading a template). */
  disabled: boolean
  /**
   * Request a fresh AI draft in `languageTag` WITHOUT selecting it — the
   * composer's `regenerateIn`; the language commits only if the preview is
   * adopted (`regenerateScope`, `reply-composer-transitions.ts`).
   */
  onRegenerate: (languageTag: string) => void
}>

/**
 * The canvas's `.aitag`: 12 px medium, `10px 12px 0` of inset so it lines up
 * with the text under it (whose own top inset the composer drops to 4 px
 * while a tag is shown). The separating spaces sit OUTSIDE the quiet spans for
 * the reason `reply-ai-menu.tsx`'s `LanguageRow` records: accessible names are
 * computed per element and trimmed, so a space inside the span is lost and the
 * name reads `AI draft· Bulgarian`.
 */
const TAG_CLASS =
  'inline-flex max-w-full min-w-0 flex-wrap items-center gap-x-1.5 self-start px-3 pt-2.5 text-xs font-medium'

function QuietPart({ text }: Readonly<{ text: string | null }>) {
  if (text === null) return null
  return (
    <>
      {' '}
      <span className="font-normal text-muted-foreground">· {text}</span>
    </>
  )
}

function TagWords({ parts }: Readonly<{ parts: ReplyDraftOriginParts }>) {
  return (
    <span className="min-w-0 wrap-anywhere">
      {parts.kind}
      <QuietPart text={parts.title} />
      <QuietPart text={parts.language} />
    </span>
  )
}

/**
 * Row 18 — what the draft in the box was made FROM, in which language.
 *
 * `AI draft · Bulgarian ▾` is a menu trigger whose rows regenerate in the
 * OTHER target (`regenerateChoices`). A row asks without committing: the tag
 * and text keep naming the draft's current language while the preview (which
 * names its own) is open. `Template · <title> · Bulgarian` is
 * plain text: a template has no "other language" of the same template — the
 * list is per-language (`reply-template-operations.ts:137`) — so the way to a
 * Turkish template is `Template ▾`'s own `Templates in` switch.
 *
 * Colour follows the contract's rule that purple is interactive-only: the AI
 * trigger takes the accent ink because it IS a control; the template tag, and
 * an AI tag with nothing to offer, are facts and print in the foreground.
 *
 * An AI tag becomes plain text rather than an empty or all-disabled menu when
 * nothing can be regenerated — no generator, a review too short for the
 * language check, or no second target (a property with no review language to
 * offer). A trigger that opens onto nothing is a control that lies about
 * being one. The plan's row names only the menu; this is the case it did not
 * draw, recorded in the PR report.
 *
 * The trigger's focus ring is INSET: the tag sits flush with the text row's
 * scroller, whose `overflow` clips anything drawn outside it, so an outer ring
 * lost its top and left edges (measured: a 3 px ring at the scrollport edge).
 *
 * Mobile (row 20): the trigger gets `max-md:min-h-9` so the one tappable thing
 * on this line is a 36 px target, and the menu's rows keep `max-md:min-h-11`
 * like every other assist menu row.
 */
export function ReplyDraftOriginTag(props: Props) {
  const parts = replyDraftOriginParts(props.origin)
  const { languageChoices } = props
  const choices = regenerateChoices(
    replyLanguageMenuEntries(languageChoices.options, languageChoices.selectedTag),
    props.origin.languageTag,
  )
  const isMenu =
    props.origin.kind === 'ai_draft' && props.canRegenerate && choices.length > 0
  const Glyph = props.origin.kind === 'ai_draft' ? Sparkles : ShieldCheck

  if (!isMenu) {
    return (
      <p className={`${TAG_CLASS} text-foreground`}>
        <Glyph aria-hidden="true" className="size-3.5 shrink-0" />
        <TagWords parts={parts} />
      </p>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={props.disabled}
        className={`${TAG_CLASS} rounded-sm pb-0.5 text-(--accent) outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-50 max-md:min-h-9`}
      >
        <Glyph aria-hidden="true" className="size-3.5 shrink-0" />
        <TagWords parts={parts} />
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={MENU_COLLISION_PADDING_PX}
        className="w-72 max-w-[calc(100vw-1rem)]"
      >
        {choices.map((choice) => (
          <DropdownMenuItem
            key={choice.tag}
            className="max-md:min-h-11"
            onSelect={() => props.onRegenerate(choice.tag)}
          >
            <Globe2 aria-hidden="true" />
            <span className="min-w-0">
              {choice.label}
              {choice.source !== null && (
                <>
                  {' '}
                  <span className="text-muted-foreground">· {choice.source}</span>
                </>
              )}
            </span>
            {/* No check mark: none of these rows is the current language —
                `regenerateChoices` removed that one. */}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
