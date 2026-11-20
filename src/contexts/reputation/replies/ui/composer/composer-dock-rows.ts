// The dock's writing rows (plan v2.1 row 14), spelled once for every surface
// that writes inside it.
//
// `reply-composer.tsx` draws the dock — the bordered box and its HEAD row — and
// hands the rest to a slot. Three slots write in it: the reply composer
// (`reply-editor-compose.tsx`), the note form (`inbox-notes-thread.tsx`) and
// the published-reply editor (`reply-editor-views.tsx`, row 9's live edit).
// Row 14 gives all three the same two rows under the head: the TEXT, and a
// FOOT carrying the one primary.
//
// Only the reply composer drew them when the dock landed. The other two kept
// the shapes they had as free-standing forms, and inside a box both went wrong
// in a real browser (Chromium against `pnpm storybook`, the pane column
// modelled at the viewport's height):
//
//   - The primary left the screen. Neither form had a scroller of its own, so
//     at 320x568 a long note put `Add note` 53.5 px below the viewport
//     (bottom 621.5 of 568) and a long live edit put `Review update` 57 px
//     below it, both behind region 4's `overflow-y-auto` backstop — v1's worst
//     defect again, in the two states nobody had re-measured. The same text in
//     reply mode kept `Submit for approval` at bottom 545, because that surface
//     already had these rows.
//   - They sat on the dock's edge. The note's `Add a note` label touched the
//     dashed border, its textarea drew a second box inside the dock, and both
//     primaries touched the dock's bottom-right corner; the live edit's count
//     sat on the left border.
//
// So the geometry that pins a primary lives here, and each surface is the same
// three pieces: its column (`DOCK_SURFACE_CLASS`), a text row that takes every
// pixel of deficit, and a foot that takes none.

/**
 * A writing surface's own column: transparent to region 4's bound.
 *
 * `min-h-0 grow basis-auto` is the chain `reply-composer.tsx` hangs its 60 %
 * cap on (see `SLOT_CLASS` there for why the basis is `auto` and not
 * `flex-1`'s zero). A block box here — or a `space-y-*` stack, which is what
 * the published editor was — has `min-height: auto` and refuses to shrink, and
 * one link that refuses is enough to push the foot out of the region.
 */
export const DOCK_SURFACE_CLASS = 'flex min-h-0 grow basis-auto flex-col'

/**
 * The dock's TEXT row — everything that grows, in ONE scroller, directly under
 * the head row `reply-composer.tsx` draws.
 *
 * No box of its own. The reply composer's used to be an `InputGroup` — border,
 * radius, shadow — which inside the dock would be a box in a box; the dock
 * draws the only edge. The focus indicator that the box's border carried moves
 * to the row: an INSET ring on the scroller while the textarea has focus, inset
 * so the scrollport cannot clip it and so it sits inside the dock's rules
 * rather than over them. A textarea keeps `aria-invalid`; with no border to
 * turn red, an over-limit state is carried by the count's own words and ink
 * (`5000/4096`, destructive) — colour never alone.
 *
 * It draws no rule: the head above and the foot below each draw their own.
 * And no bleed either — the scroller used to be pulled 4 px out (`-mx-1 -my-1
 * p-1`) so a focus ring on the old box was not clipped; with the ring inset
 * on the row itself there is nothing to make room for, and a scrollport pulled
 * over the head's rule would paint scrolled text across it.
 */
export const DOCK_TEXT_ROW_CLASS =
  'flex min-h-0 grow basis-auto flex-col overflow-y-auto overscroll-contain has-[textarea:focus-visible]:ring-[3px] has-[textarea:focus-visible]:ring-ring/50 has-[textarea:focus-visible]:ring-inset'

/**
 * The canvas's `.ta`: 10 px / 12 px of inset, 15 px text at 1.55. `resize-none`
 * because the region's `[&_textarea]:max-h-80` cap (`reply-composer.tsx`,
 * `SLOT_CLASS`) is what bounds the box, and a drag handle would argue with it.
 */
export const DOCK_TEXTAREA_CLASS =
  'min-h-[72px] resize-none rounded-none border-0 bg-transparent px-3 py-2.5 text-base leading-relaxed shadow-none focus-visible:ring-0 aria-invalid:ring-0 md:text-[15px] dark:bg-transparent'

/**
 * The canvas's `.dock-foot`: tools at the leading edge, then `count` and the
 * one primary at the trailing edge, 6 px of inset under a rule.
 *
 * It sits OUTSIDE the scroller, and that is the load-bearing half of the
 * region's bound: the scroller above is the only thing with `min-h-0`, so when
 * the region's 60 % cap bites, all of the deficit lands there and the foot —
 * with the primary in it — keeps its content height at the bottom of the dock.
 * Before PR 3's fix `Submit for approval` sat 256 px below a clip; the foot has
 * been outside the scroller since, and every surface in the dock now shares it.
 *
 * It WRAPS. On a 390 px phone the reply's tools, count and `Submit for
 * approval` do not fit one line; a wrapped foot is two short rows, a scrolled
 * one hides its primary (PR 2's measured lesson about rows behind hidden
 * scrollbars).
 */
export const DOCK_FOOT_ROW_CLASS =
  'flex shrink-0 flex-wrap items-center gap-1.5 border-t p-1.5'
