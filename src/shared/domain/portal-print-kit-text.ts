// Line breaking and fitting for the print kit, independent of any PDF library:
// the caller supplies the measure, so these are testable with a stub.

/** How close the balanced width search gets, in the measure's units (points). */
const BALANCE_PRECISION = 0.25

/**
 * `text` in as many lines as it needs at `maxWidth`, with the lines as even as
 * that number of lines allows, as CSS `text-wrap: balance` sets a headline: the
 * narrowest width that still breaks into the same number of lines. A word wider
 * than the line stands alone.
 */
export function balanceWords(
  text: string,
  maxWidth: number,
  measure: (line: string) => number,
  breaks: LineBreaks = 'spaces',
): string[] {
  const greedy = (width: number) => fillWords(text, width, measure, breaks)
  const lines = greedy(maxWidth)
  if (lines.length < 2) return lines
  let narrow = 0
  let wide = maxWidth
  while (wide - narrow > BALANCE_PRECISION) {
    const middle = (narrow + wide) / 2
    if (greedy(middle).length > lines.length) narrow = middle
    else wide = middle
  }
  return greedy(wide)
}

/**
 * Where a line may break: at spaces only, or also after a hyphen between two
 * letters, as a browser breaks "HOUSTON-NEAR" ("HOUSTON-" ends the line).
 */
export type LineBreaks = 'spaces' | 'spaces-and-hyphens'

/**
 * Whitespace a line may break at: every kind but the no-break spaces (U+00A0 and
 * U+202F), which keep "nous ?" together as a browser does.
 */
const BREAKING_SPACE = /[^\S\u00a0\u202f]+/u

/** The pieces a line is built from, each with whether a space joins it to the one before. */
function piecesOf(text: string, breaks: LineBreaks) {
  const words = text.split(BREAKING_SPACE).filter((part) => part !== '')
  return words.flatMap((word) => {
    const parts = breaks === 'spaces' ? [word] : word.split(/(?<=[^\s-]-)(?=[^\s-])/u)
    return parts.map((part, index) => ({ part, spaced: index === 0 }))
  })
}

/** The plain greedy fill, as a paragraph sets: each line takes as many words as fit. */
export function fillWords(
  text: string,
  maxWidth: number,
  measure: (line: string) => number,
  breaks: LineBreaks = 'spaces',
): string[] {
  const lines: string[] = []
  let current = ''
  for (const { part, spaced } of piecesOf(text, breaks)) {
    const candidate = current === '' ? part : `${current}${spaced ? ' ' : ''}${part}`
    if (current !== '' && measure(candidate) > maxWidth) {
      lines.push(current)
      current = part
    } else {
      current = candidate
    }
  }
  if (current !== '') lines.push(current)
  return lines
}
