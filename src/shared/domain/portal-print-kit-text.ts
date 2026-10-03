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
  const words = text.split(/\s+/u).filter((word) => word !== '')
  if (words.length === 0) return []
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`
    if (current !== '' && measure(candidate) > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  lines.push(current)
  return lines.length === 2 ? balancedPair(words, measure) : lines
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

/**
 * The two lines an address too long for one is broken into: before its last
 * slash, so they read host/path and then the code. Null when there is no such
 * break (the address stays on one line).
 */
export function breakAddress(address: string): readonly [string, string] | null {
  const cut = address.lastIndexOf('/') + 1
  return cut > 0 && cut < address.length
    ? [address.slice(0, cut), address.slice(cut)]
    : null
}
