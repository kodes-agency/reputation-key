// Line breaking and fitting for the print kit, independent of any PDF library:
// the caller supplies the measure, so these are testable with a stub.

/**
 * `text` broken into lines no wider than `maxWidth`. A word wider than the line
 * stands alone rather than being cut. When the greedy fill leaves exactly two
 * lines, the break moves to the most even one: a balanced pair of lines reads
 * as a headline, a long line over a one-word stub does not.
 */
export function wrapWords(
  text: string,
  maxWidth: number,
  measure: (line: string) => number,
): string[] {
  const lines = fillWords(text, maxWidth, measure)
  if (lines.length !== 2) return lines
  return balancedPair(
    text.split(/\s+/u).filter((word) => word !== ''),
    measure,
  )
}

function balancedPair(words: readonly string[], measure: (line: string) => number) {
  let best: string[] = [words.join(' ')]
  let bestWidth = Number.POSITIVE_INFINITY
  for (let split = 1; split < words.length; split += 1) {
    const pair = [words.slice(0, split).join(' '), words.slice(split).join(' ')]
    const width = Math.max(...pair.map(measure))
    if (width < bestWidth) {
      best = pair
      bestWidth = width
    }
  }
  return best
}

/** How close the balanced width search gets, in the measure's units (points). */
const BALANCE_PRECISION = 0.25

/**
 * `text` in as many lines as it needs at `maxWidth`, with the lines as even as
 * that number of lines allows, as CSS `text-wrap: balance` sets a headline: the
 * narrowest width that still breaks into the same number of lines. A word wider
 * than the line stands alone, as in `wrapWords`.
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

const SHRINK_STEP = 0.25

/**
 * The largest size, at most `size` and at least `minSize`, at which the text is
 * no wider than `maxWidth`. `widthAt` measures the text at a given size.
 */
export function fitFontSize(
  input: Readonly<{
    size: number
    minSize: number
    maxWidth: number
    widthAt: (size: number) => number
  }>,
): number {
  let size = input.size
  while (size > input.minSize && input.widthAt(size) > input.maxWidth) {
    size -= SHRINK_STEP
  }
  return Math.max(size, input.minSize)
}

/** No text is set smaller than this: below it a line is a smudge, and no line fits it to a width. */
const SMALLEST_SIZE = 4

export type FittedLines = Readonly<{ lines: readonly string[]; size: number }>

/**
 * `text` set to a width. One line at the largest size, down to `minSize`, when
 * it fits there; else wrapped into at most `maxLines` balanced lines at the
 * largest size at which they fit, which may be smaller than `minSize` for text
 * far longer than any brand. A word wider than the width is never broken, so it
 * is shrunk to fit instead. Text is never left wider than `maxWidth` unless it
 * would have to be set below the smallest size.
 */
export function fitLines(
  input: Readonly<{
    text: string
    size: number
    minSize: number
    maxLines: number
    maxWidth: number
    /** The width of `text` set at `size`. */
    widthAt: (text: string, size: number) => number
  }>,
): FittedLines {
  const { text, maxWidth, widthAt } = input
  if (text.trim() === '') return { lines: [], size: input.size }
  const single = [text.trim().replace(/\s+/gu, ' ')]
  const size = fitFontSize({
    size: input.size,
    minSize: input.minSize,
    maxWidth,
    widthAt: (candidate) => widthAt(single[0] ?? '', candidate),
  })
  if (widthAt(single[0] ?? '', size) <= maxWidth) return { lines: single, size }
  let candidate = input.size
  for (;;) {
    const lines = wrapWords(text, maxWidth, (line) => widthAt(line, candidate))
    const widest = Math.max(...lines.map((line) => widthAt(line, candidate)))
    const fits = lines.length <= input.maxLines && widest <= maxWidth
    if (fits || candidate <= SMALLEST_SIZE) return { lines, size: candidate }
    candidate = Math.max(SMALLEST_SIZE, candidate - SHRINK_STEP)
  }
}
