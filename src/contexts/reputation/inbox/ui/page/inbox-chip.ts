/**
 * Geometry of the inbox's remaining chips: a `Badge` (already `rounded-full`,
 * `ui/badge.tsx:8`) with room for a leading glyph.
 *
 * Plan v2.1 row 2 splits the pane's affordances into three looks — a CONTROL
 * is an outlined button in a `ButtonGroup`, a FACT is plain text with a glyph,
 * a DETAIL is that text with a dotted underline — and says nothing else in the
 * case toolbar may be a pill. So the toolbar no longer uses this class, and
 * its interactive sibling `INBOX_CHIP_TRIGGER_CLASS` (a `Button` dressed as a
 * 26 px pill that grew to 44 px below `md`) is deleted outright: no control is
 * a chip any more.
 *
 * What is left is genuinely a chip — a short static label describing one
 * thing inside the thread, never a target:
 *
 * - `topic-chips.tsx` — one aspect mention (`Room · Complaint`) and the
 *   `Needs attention` flag. Row 10: "Topic chips unchanged (v1 row 11)".
 * - `reply-message.tsx` — the reply's lifecycle state (`Pending approval`,
 *   `Published`, …). PR 3 keeps its shape (plan § PR 3).
 *
 * It lived in `inbox-assignee-chip.tsx` until PR 2 only because the case strip
 * was its first consumer; a chip constant has no business in the owner
 * control, which is not a chip.
 */
export const INBOX_CHIP_STATIC_CLASS = 'gap-1.5 px-2.5 py-1'
