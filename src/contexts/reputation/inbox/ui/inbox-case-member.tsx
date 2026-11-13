// The case toolbar's control geometry and the edge rules that keep a control's
// own border beside a fact, in one place so the three members cannot drift
// apart. The fact itself (`Fact`) lives in `ui/fact.tsx`, shared so the portal
// workspace prints its facts the same way.
//
// A fact is plain 13 px text with a glyph and NO box: `ButtonGroupText` with the
// primitive's own box (`rounded-md border bg-muted shadow-xs`) taken off. Boxed,
// a fact and a control are indistinguishable at 390 px, where a control collapses
// to a 36 px glyph square (fill contrast 1.05:1 light, 1.09:1 dark).
//
// A control's geometry for the owner and escalation members is the Button's
// `iconBelow="md"`: 32 px from `md` up, a glyph square below it, as wide as the
// Button is tall there (the 44 px touch height). The priority member is the
// same square, but by the TOOLBAR's width and not the window's
// (`iconBelow="@lg"`): the detail pane is as narrow as 424 px of toolbar on a
// 1280 px laptop (`inbox-priority-control.tsx`). The status control is
// deliberately NOT this shape: its word is the information, so it keeps
// `[● Closed ▾]` at every width.

/**
 * Restores a control's own edge where it meets a fact. `ButtonGroup` squares
 * every inner corner and drops every non-first member's left border
 * (`ui/button-group.tsx:13`), which is right between two outlined buttons and
 * wrong beside a fact, which draws no box: `● Open [GH ▾]` would lose
 * the owner trigger's left border and both its left radii. Each selector is one
 * attribute more specific than the group's own (0,3,0 against 0,2,0), so the
 * result does not depend on the order Tailwind emits the two rules in.
 *
 * The facts are found by `data-fact`, not by position, because which
 * members are facts depends on the viewer's permissions and on the item: a
 * Member can see `● Open [👤 ▾] ⚑ Escalated`, a fact on both sides of one
 * control.
 */
export const CASE_GROUP_CLASS =
  '[&>[data-fact]+:not([data-fact])]:rounded-l-md [&>[data-fact]+:not([data-fact])]:border-l [&>:not([data-fact]):has(+[data-fact])]:rounded-r-md'
