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
