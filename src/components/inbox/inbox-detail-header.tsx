import { ArrowLeft, MessageSquare, X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { InboxDetailState } from './use-inbox-detail'
import { InboxDetailCopyMenu } from './inbox-detail-copy-menu'

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
 * property · platform · copy menu · close/back, and no longer reads
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
 */
export function InboxDetailHeader({ item, detail, onClose, dismiss = 'close' }: Props) {
  return (
    <header className="flex h-14 min-w-0 shrink-0 items-center gap-2 border-b px-5 lg:px-6">
      {dismiss === 'back' && (
        <Button
          size="icon-sm"
          variant="ghost"
          // 36 px below `md` (row 20 — v1's row 15 made it 44), and pulled
          // back into the header's own padding so its GLYPH, not its box, sits
          // on the content edge. A ghost button draws no box at rest; the arrow
          // is the only thing on screen, so the arrow is what has to line up.
          // The rule is half of (button − 16 px glyph): 8 px for a 32 px
          // button, which is exactly the list header's drawer trigger's `-ml-2`
          // (`inbox-list-header.tsx:54`), and 10 px for this 36 px one, so
          // `-ml-2.5`. Keeping `-ml-2` after the resize would have left the
          // arrow 2 px right of that line; v1's `-ml-2` on a 44 px button left
          // it 6 px right.
          //
          // Measured in Chromium against Storybook dev at 390 and 320
          // (`inbox-mobile-390--review-closed`): the arrow's left edge was
          // x=27 and is now x=21 — the same x as the case toolbar's first
          // control below it (`px-5` inside the sheet's 1 px `border-l`), and
          // 1 px (that border) from the list's `Menu` glyph at x=20
          // (`pages-inbox--mobile-viewport`), so the leading glyph does not jump
          // when the sheet slides over the list. The list's trigger is still
          // 32 px with no mobile treatment — above WCAG 2.5.8's 24 px, under
          // row 20's 36, and outside this pane. The sheet is this variant's
          // only caller and it renders only below `md`, so neither the size
          // nor the negative margin needs a breakpoint beyond `max-md:size-9`.
          className="-ml-2.5 max-md:size-9"
          aria-label="Back to list"
          onClick={onClose}
        >
          <ArrowLeft />
        </Button>
      )}

      {/* Two `max-md:hidden`s, and they were the difference between this
          block saying something and saying nothing. When this row still held
          Escalate its fixed children cost 252 px at 320 px wide (40 padding +
          44 dismissal + 100 Escalate + 44 copy menu + 24 gaps), so the name
          absorbed the deficit — and measured with all three present it
          absorbed ALL of it: the name span came out 0 px and the `shrink-0`
          platform tag, the one thing left, overflowed the block by 11 px and
          was clipped too. A 320 px phone read `· google` and nothing about
          which property. Escalate has since moved to the case toolbar (plan
          v2.1 row 5), which frees 108 px; the two hides stay, because the
          phone's name is still the one thing on this row worth the width and
          nobody has measured whether glyph and tag would now fit beside it.

          The 24 px `MessageSquare` is decoration — no label, no meaning, and a
          second glyph a gap away from the back arrow. The platform is real, but
          it is on the list row that was tapped to get here
          (`inbox-list-v2.tsx:97`) and the reply's own state chip says Google
          again further down. Giving the name what the two of them were holding
          took it from 0 px to 75 px at 320, and from 60 px to 145 px at 390,
          measured with Escalate still present.
          Below `md` only, and the desktop panel never renders below `md`
          (`hidden md:flex`), so nothing about the desktop header moves. */}
      <div className="mr-auto flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <MessageSquare className="shrink-0 text-muted-foreground max-md:hidden" />
        <span className="truncate text-sm font-semibold">
          {item.propertyName ?? 'Property'}
        </span>
        {item.platform && (
          <span className="shrink-0 text-xs text-muted-foreground max-md:hidden">
            · {item.platform}
          </span>
        )}
      </div>

      <InboxDetailCopyMenu detail={detail} />

      {dismiss === 'close' && (
        <Button
          size="icon-sm"
          variant="ghost"
          // Row 20's 36 px, the same square as `Back to list` and the copy
          // menu. `close` is the desktop panel's variant and the panel is
          // `hidden md:flex`, so in the app this class never matches — measured
          // at 390, `inbox-detail-panel--populated` renders no control at all.
          // It is spelled anyway so a caller that ever mounts `close` below
          // `md` gets a control-sized target, not the desktop's 32 px.
          className="max-md:size-9"
          aria-label="Close detail"
          onClick={onClose}
        >
          <X />
        </Button>
      )}
    </header>
  )
}
