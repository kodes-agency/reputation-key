import { X } from 'lucide-react'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { InboxDetailState } from './use-inbox-detail'
import { InboxDetailCopyMenu } from './inbox-detail-copy-menu'
import { BackIconButton } from '#/components/ui/back-icon-button'
import { IconButton } from '#/components/ui/icon-button'
import { KindGlyph, kindMarkerWords } from './inbox-kind-marker'

/**
 * How this pane is left, and therefore where the control sits and what it says.
 *
 * `close` — the desktop panel. The pane shares the viewport with the list it
 * was opened from, the list stays visible and usable beside it, and nothing was
 * navigated to get here: an X at the trailing end dismisses a thing that is
 * merely open. This is the default, so `inbox-detail-panel.tsx` is unchanged
 * and the e2e a11y scan's `Close detail` keeps matching it.
 *
 * `back` — the mobile sheet. Opening an item there IS a navigation: the row
 * pushes `itemId` into the search (`inbox-state-helpers.ts:28`), a history
 * entry and all, and the sheet is `w-full` below `sm`, so it covers the list
 * completely — there is no overlay left to tap past and a phone has no Escape
 * key. The control is the only way back to the list, so it takes the leading
 * edge and is named for where it goes rather than for what it shuts.
 */
export type InboxDetailDismiss = 'close' | 'back'

type Props = Readonly<{
  item: InboxItem
  detail: InboxDetailState['detail']
  /** "Check on Google" and the return from Google; absent where neither is offered. */
  googleCheck?: InboxDetailState['googleCheck']
  onClose: () => void
  /** Defaults to the desktop panel's trailing X; see `InboxDetailDismiss`. */
  dismiss?: InboxDetailDismiss
}>

/**
 * Region 1 of the pane: context on the left, the copy menu and the dismissal on
 * the right. Fixed height and `shrink-0` because it shares a bounded flex column
 * with the case toolbar and a pinned composer — without them it compresses
 * first. Case state (status, owner, escalation, reply due) lives in the
 * toolbar, not here.
 *
 * Plan v2.1 row 5 moved `InboxDetailManagerActions` (Escalate / Resolve) out of
 * this row and into the toolbar's `ButtonGroup`, so the header keeps exactly
 * kind · property · copy menu · close/back, and no longer reads
 * `usePermissions` or the detail state's commands at all.
 *
 * The row cannot wrap and both containers clip (`overflow-hidden` on the panel
 * root and on `SheetContent`), so the left block carries `min-w-0` and clips:
 * any floor there pushes the action cluster off the right edge of a phone-width
 * sheet, and the dismissal is the only way out of it. The name truncates
 * instead.
 *
 * What was measured. v1 measured this row at 320 px in a real Tailwind build
 * with a 40-character property name and `inbox.manage`: the dismissal, Escalate
 * and the copy menu all fully inside the viewport, `scrollWidth ===
 * clientWidth`, and 75 px left for the name. That measurement included Escalate
 * and no longer describes this row.
 *
 * PR 5 (plan v2.1 row 20) lowered both icon controls from 44 px to 36 and
 * measured the row in Chromium against Storybook dev, where Tailwind compiles
 * (`inbox-mobile-390--review-closed`, `--header-at-320`). Before: `Back to
 * list` and `More review actions` 44x44, the name block 253 px wide at 390 and
 * 183 px at 320. After: both 36x36, the name block 271 px at 390 and 201 px at
 * 320 — 390 less the sheet's 1 px `border-l`, 40 padding, 36 back + 36 copy
 * menu, 16 for the two `gap-2`s, plus the 10 px the back button's `-ml-2.5`
 * hands back. `scrollWidth === innerWidth` at both widths, before and after.
 * The committed gate for the rule behind them (every control >= 36 px, no
 * overflow) is `e2e/storybook-metrics/inbox-detail.metrics.ts`.
 *
 * Phone grid since then: a 44 px bar with a 16 px gutter (`max-md:h-11
 * max-md:px-4`), and no `border-l` on the sheet below `sm`. The same sum is
 * 32 padding and no border, so 280 px at 390 and 210 at 320 (computed, not
 * re-measured). 44 px is also what the app top bar this sheet covers is on
 * inbox phones, so the top edge does not jump when a review opens.
 */
export function InboxDetailHeader({
  item,
  detail,
  googleCheck,
  onClose,
  dismiss = 'close',
}: Props) {
  return (
    <header className="flex h-14 min-w-0 shrink-0 items-center gap-2 border-b px-5 max-md:h-11 max-md:px-4 lg:px-6">
      {dismiss === 'back' && (
        // The one back control, the arrow alone (this row has no room for words) and
        // `flush`: its glyph, not its 36 px box, sits on the 16 px phone gutter, the
        // same x as the list's glyphs and the case toolbar's first control. The sheet
        // is this variant's only caller, and it is the compact layout, which renders
        // up to 1077 px, so tablets keep the 32 px button inside the 20 px gutter;
        // `flush` is not gated by a breakpoint.
        <BackIconButton flush label="Back to list" onClick={onClose} />
      )}

      {/* Which kind of work this is, in the rail's own words (ADR 0057, amended
          2026-10-28): the kind's glyph, then the property, then `· Google
          review` / `· Review` / `· Private feedback`. It replaces the decorative
          chat glyph and the platform word, which a phone hid altogether and which
          left private feedback with no mark but the rail it was opened from.

          The glyph shows at every width. The words share the line with the
          property only when both fit: the block wraps, is one line high and clips,
          so a name that needs the room keeps it and the words fall onto the
          clipped second line (still there for a screen reader, as `sr-only` would
          leave them). Below `md` that is the usual case at 320 px; from `md` the
          words are nearly always whole. The name block is `flex-1`, so nothing
          here pushes the copy menu or the dismissal off a phone's right edge,
          which they must never leave. */}
      <div className="mr-auto flex h-5 min-w-0 flex-1 flex-wrap items-center gap-x-2 overflow-hidden">
        <span className="flex min-w-0 items-center gap-2">
          <KindGlyph item={item} />
          <span className="truncate text-sm font-semibold">
            {item.propertyName ?? 'Property'}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          · {kindMarkerWords(item)}
        </span>
      </div>

      <InboxDetailCopyMenu detail={detail} googleCheck={googleCheck} />

      {dismiss === 'close' && (
        <IconButton
          size="icon-sm"
          variant="ghost"
          // `close` is the desktop panel's variant and the panel is
          // `hidden md:flex`, so below `md` it is never in the app; a caller that
          // mounts it there gets the same compact 36 px as `Back to list`.
          label="Close detail"
          onClick={onClose}
        >
          <X />
        </IconButton>
      )}
    </header>
  )
}
