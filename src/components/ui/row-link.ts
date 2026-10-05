// How a row of a list or a table opens things (UI consistency scan: COLL-20).
// The convention was the Properties and Portals lists' own, copied as a local
// `FOCUS_RING` into three files and contradicted by a third list that drew its
// counts in the link purple.
//
// - A row has one way in: its name, a link in the accent ink (`styles.css` gives
//   every plain anchor that default), underlined on hover. `ROW_NAME_LINK` adds
//   the underline and the ring; it names no colour.
// - Any other link in a row (an attention count, a setup step, a topic's mentions)
//   is a figure or a note, and figures do not turn purple: `ROW_FIGURE_LINK` is the
//   text's own ink with the same underline and ring.
// - A row that is a link as a whole (an overview review, an organisation's Property
//   in the AI overview) wears `ROW_LINK_SURFACE`: the text's ink, the one hover tint
//   and the ring. A selectable master-detail row (the Inbox) is a button, not this.
//
// Utilities beat the base layer's anchor default, so none of these needs an
// important modifier. Every class is written out in full for Tailwind.

/** The row's one way in: the name, accent ink, underlined on hover. */
export const ROW_NAME_LINK = 'rounded-sm underline-offset-4 hover:underline focus-ring'

/** A figure or a note in a row that opens something: the text's ink, never the accent. */
export const ROW_FIGURE_LINK =
  'rounded-sm text-foreground underline-offset-4 hover:underline focus-ring'

/** A whole row that is a link: the text's ink, one hover tint, the ring. */
export const ROW_LINK_SURFACE =
  'text-foreground transition-colors hover:bg-muted/40 focus-ring'
