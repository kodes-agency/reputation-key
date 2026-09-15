import { useId, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, Globe2, Languages } from 'lucide-react'
import { DropdownMenuItem } from '#/components/ui/dropdown-menu'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  propertyLanguageMissingReason,
  type ReplyLanguageMenuEntry,
} from './reply-assist-language'
import type { ReviewLanguageReadiness } from './reply-language-options'
import type { ReplyLanguageChoices } from './use-reply-composer'

/*
 * The pieces `reply-ai-menu.tsx` and `reply-template-menu.tsx` draw.
 * Split out of `reply-suggestion-controls.tsx`, which sat at 294 of 300
 * counted lines and could not take the language (plan v2.1, PR 4).
 */

/**
 * A split button's word, hidden below `md` (row 20: on a phone the two assist
 * controls are 36 px glyph squares — sparkle, shield — because the language
 * now lives inside their menus and nothing else in the dock's foot needs the
 * room). `sr-only`, not `hidden` and not an `aria-label`: the word stays the
 * accessible name at every width, and it stays the SAME word the button
 * prints. An `aria-label="Draft with AI"` would override the visible
 * `Drafting…` while a draft is generating, and a screen reader would announce
 * an action the button is not offering. `inbox-owner-control.tsx` collapses its
 * trigger the same way.
 */
export const ASSIST_LABEL_CLASS = 'max-md:sr-only'

/**
 * Both menus are 288 px (`w-72`) and open from the start edge of a trigger that
 * can sit near the right edge of a phone. Radix's default collision padding is
 * 0, so the menu was measured flush with the viewport — right edge 390 of 390
 * in Chromium at 390 px — its border on the glass. 8 px keeps a visible gutter,
 * and `max-w-[calc(100vw-1rem)]` on the content is the same 8 px either side,
 * so a 320 px phone (288 + 16 = 304) still fits without clipping.
 */
export const MENU_COLLISION_PADDING_PX = 8

/**
 * A section heading inside a menu (`Tone`, `Write in`, `Templates in`) — the
 * canvas's `.msec`: 11 px, medium, tracked caps, tertiary ink. It is text, not
 * an item, so it takes no role of its own; the `DropdownMenuGroup` it heads
 * names itself with `aria-labelledby` pointing here, which is how a screen
 * reader hears `Write in, group` on entering the language rows.
 */
export function AssistSectionLabel({
  id,
  children,
}: Readonly<{ id: string; children: ReactNode }>) {
  return (
    <div
      id={id}
      className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
    >
      {children}
    </div>
  )
}

/**
 * The selected row's check. A shape, so the selection never rests on the
 * row's fill alone (contract, "Colour and token rules"); `aria-hidden`
 * because the row carries `aria-current` for assistive tech. Accent ink read
 * straight from the token — a menu row is interactive, so purple is allowed,
 * and `text-primary` diverges from `--accent` in the dark theme
 * (`inbox-owner-control.tsx`, `DISC_TONE`).
 */
export function SelectedMark({ className = '' }: Readonly<{ className?: string }>) {
  return <Check aria-hidden="true" className={`text-(--accent) ${className}`} />
}

type LanguageRowProps = Readonly<{
  entry: ReplyLanguageMenuEntry
  updateLanguage: ReplyLanguageChoices['updateLanguage']
}>

/**
 * One language row: `Bulgarian · property default`, the source quiet, a check
 * on the selected row — shared by the `Write in` group of `Draft with AI ▾`
 * and the `Templates in` switch, so the two cannot disagree about what a
 * language is called. A disabled option
 * (`Detect automatically` on a review too short to detect) keeps its reason in
 * its own text after a dash — the pattern `reply-language-select.tsx` used — so
 * the reason reaches a screen reader rather than hiding in a tooltip nobody can
 * hover.
 *
 * Picking a language does NOT draft. It calls `updateLanguage` and the menu
 * closes; the manager then presses `Draft with AI`. A row that both switched
 * the language and regenerated would spend an AI call — and replace whatever
 * the manager had written, with only `Undo` to get it back — on a mis-tap
 * between two adjacent rows. The scope `updateLanguage` returns is dropped for
 * the same reason: nothing in this event acts in the new language. Re-picking
 * the selected row is a no-op: `updateLanguage` would still dismiss a pending
 * suggestion and bump the draft's revision (`use-reply-composer.ts`), for no
 * change.
 */
export function LanguageRow({ entry, updateLanguage }: LanguageRowProps) {
  return (
    <DropdownMenuItem
      disabled={entry.disabledReason !== null}
      aria-current={entry.isSelected ? 'true' : undefined}
      className="max-md:min-h-11"
      onSelect={() => {
        if (!entry.isSelected) updateLanguage(entry.tag)
      }}
    >
      <Globe2 aria-hidden="true" />
      {/* The separating spaces sit OUTSIDE the quiet spans: an accessible
          name is computed per element and each element's text is trimmed, so
          a leading space inside the span is dropped and the row reads
          `Bulgarian· property default` (measured in the Storybook runner). */}
      <span className="min-w-0">
        {entry.name}
        {entry.source !== null && (
          <>
            {' '}
            <span className="text-muted-foreground">· {entry.source}</span>
          </>
        )}
        {entry.disabledReason !== null && (
          <>
            {' '}
            <span className="text-muted-foreground">— {entry.disabledReason}</span>
          </>
        )}
      </span>
      {entry.isSelected && <SelectedMark className="ml-auto" />}
    </DropdownMenuItem>
  )
}

type MissingProps = Readonly<{
  propertyId: string
  reviewLanguageReadiness: ReviewLanguageReadiness
  isAutoDetecting: boolean
}>

/**
 * Row 18: `Property reply language not set` stops being a standing `Alert`
 * above the box (`reply-language-readiness.tsx`, deleted) and becomes ONE row
 * in each assist menu, beside the language choice it explains. The caller
 * renders it only when the property has no default.
 *
 * A manager with `ai.manage` gets the fix: `Set property language`, the same
 * link to `/settings/ai` the alert carried. Anyone else gets the read-only
 * sentence. Either way the readiness sentence rides along as a second line and
 * as the row's `aria-describedby`, so the name stays the short action
 * (`getByRole('menuitem', { name: 'Set property language' })`) while a screen
 * reader still hears why the default matters.
 *
 * The read-only row is `aria-disabled` and swallows `onSelect`, NOT Radix's
 * `disabled`: Radix's `disabled` removes the row from roving focus, and a
 * sentence whose only purpose is to be read would then be unreachable by
 * arrow key — the APG menu pattern keeps disabled items focusable for exactly
 * this. It is not dimmed either (`data-[disabled]:opacity-50` would put muted
 * ink at half opacity); the muted foreground already says "not an action".
 */
export function PropertyLanguageMissingItem({
  propertyId,
  reviewLanguageReadiness,
  isAutoDetecting,
}: MissingProps) {
  const { can } = usePermissions()
  const reasonId = useId()
  const reason = propertyLanguageMissingReason(reviewLanguageReadiness, isAutoDetecting)
  const detail = (
    <span id={reasonId} className="text-xs text-muted-foreground">
      {reason}
    </span>
  )

  if (can('ai.manage')) {
    return (
      <DropdownMenuItem
        asChild
        aria-label="Set property language"
        aria-describedby={reasonId}
        className="flex-col items-start gap-0.5 max-md:min-h-11"
      >
        <Link to="/properties/$propertyId/settings/replies" params={{ propertyId }}>
          <span className="flex items-center gap-2">
            <Languages aria-hidden="true" />
            Set property language
          </span>
          {detail}
        </Link>
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenuItem
      aria-disabled="true"
      aria-label="Ask a manager to set this property’s reply language"
      aria-describedby={reasonId}
      className="flex-col items-start gap-0.5 text-muted-foreground max-md:min-h-11"
      onSelect={(event) => event.preventDefault()}
    >
      <span className="flex items-center gap-2">
        <Languages aria-hidden="true" />
        Ask a manager to set this property’s reply language
      </span>
      {detail}
    </DropdownMenuItem>
  )
}
