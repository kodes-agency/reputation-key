// What the Share tab calls each style and piece, and how each is printed (spec
// 7.2): the radio cards' words and the "How to print" steps, per style, piece and
// paper. Copy only, in one place, so each line is tested as written and the
// preview's captions and the file name read the same nouns.
//
// Measures are in inches first on Letter and in millimetres on A4, as the pieces
// are cut (spec 4.1 and 5.1). A measure and its unit never part at a line end:
// `tight` joins them with a no-break space, as the boards do.

/** One line of "How to print". */
export type PrintKitHowToStep = Readonly<{
  text: string
  /** A phrase of `text` to set in bold. */
  strong?: string
  /** Only a print with a second language needs it: the card then has a back. */
  withSecondLanguage?: true
}>
