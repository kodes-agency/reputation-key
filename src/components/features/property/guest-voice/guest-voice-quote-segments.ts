// Cuts a live review into what to print: the plain text and the cited sentences, which
// the page underlines. The read model hands over the whole text and the character
// ranges of the sentences it cites (contract, section 6.2); a long review is shown as
// the cited stretch with a little around it, never as a wall of text, and always
// at word boundaries.

type QuoteSegment = Readonly<{ text: string; highlighted: boolean }>

type Span = Readonly<{ start: number; end: number }>

/** A review this short is quoted whole. */
const WHOLE_TEXT_LIMIT = 280
/** What is kept before and after a cited stretch. */
const CONTEXT_CHARS = 70
/** The most that is kept of the text around one cited stretch, and in all. */
const EXCERPT_LIMIT = 360

const ELLIPSIS = '…'

/** The cited ranges inside the text, in order, with the ones that touch joined. */
function citedSpans(text: string, ranges: readonly Span[]): readonly Span[] {
  const clamped = ranges
    .map(({ start, end }) => ({
      start: Math.max(0, Math.min(text.length, Math.floor(start))),
      end: Math.max(0, Math.min(text.length, Math.floor(end))),
    }))
    .filter(({ start, end }) => end > start)
    .sort((left, right) => left.start - right.start)
  const joined: Span[] = []
  for (const span of clamped) {
    const last = joined.at(-1)
    if (last !== undefined && span.start <= last.end) {
      joined[joined.length - 1] = { start: last.start, end: Math.max(last.end, span.end) }
    } else {
      joined.push(span)
    }
  }
  return joined
}

const isSpace = (character: string | undefined) =>
  character === undefined || /\s/u.test(character)

/** The nearest word start at or after `index` (the text's own start counts). */
function wordStartFrom(text: string, index: number): number {
  let cursor = index
  while (cursor < text.length && cursor > 0 && !isSpace(text[cursor - 1])) cursor += 1
  return cursor
}

/** The nearest word end at or before `index` (the text's own end counts). */
function wordEndUpTo(text: string, index: number): number {
  let cursor = index
  while (cursor < text.length && cursor > 0 && !isSpace(text[cursor])) cursor -= 1
  return cursor
}

/** The stretch kept around one cited stretch: some context, at word boundaries. */
function windowAround(text: string, span: Span): Span {
  const from = Math.min(
    span.start,
    wordStartFrom(text, Math.max(0, span.start - CONTEXT_CHARS)),
  )
  let to = Math.max(
    span.end,
    wordEndUpTo(text, Math.min(text.length, span.end + CONTEXT_CHARS)),
  )
  if (to - from > EXCERPT_LIMIT) {
    // A cited stretch longer than the limit is cut at a word, its tail left out.
    to = Math.max(from + 1, wordEndUpTo(text, from + EXCERPT_LIMIT))
  }
  return { start: from, end: to }
}

/** The windows to show, in order, overlapping ones joined, within the limit in all. */
function keptWindows(text: string, spans: readonly Span[]): readonly Span[] {
  if (spans.length === 0) {
    return [{ start: 0, end: Math.max(1, wordEndUpTo(text, EXCERPT_LIMIT)) }]
  }
  const windows: Span[] = []
  let kept = 0
  for (const span of spans) {
    const next = windowAround(text, span)
    const last = windows.at(-1)
    if (last !== undefined && next.start <= last.end) {
      const joined = { start: last.start, end: Math.max(last.end, next.end) }
      kept += joined.end - joined.start - (last.end - last.start)
      windows[windows.length - 1] = joined
      continue
    }
    if (last !== undefined && kept + (next.end - next.start) > EXCERPT_LIMIT) break
    windows.push(next)
    kept += next.end - next.start
  }
  return windows
}

/** The text between `from` and `to`, with the cited spans inside it marked. */
function cut(
  text: string,
  from: number,
  to: number,
  spans: readonly Span[],
): QuoteSegment[] {
  const segments: QuoteSegment[] = []
  let cursor = from
  for (const span of spans) {
    const start = Math.max(span.start, from)
    const end = Math.min(span.end, to)
    if (end <= start) continue
    if (start > cursor)
      segments.push({ text: text.slice(cursor, start), highlighted: false })
    segments.push({ text: text.slice(start, end), highlighted: true })
    cursor = end
  }
  if (cursor < to) segments.push({ text: text.slice(cursor, to), highlighted: false })
  return segments
}

/**
 * The segments of a quote. Ranges are offsets into `text`; one outside it is clamped,
 * an empty one dropped, overlapping ones joined. A text over 280 characters is cut to
 * the cited stretches and a little context, with an ellipsis where text was left out.
 */
export function quoteSegments(
  text: string,
  ranges: readonly Span[],
): readonly QuoteSegment[] {
  const spans = citedSpans(text, ranges)
  if (text.length <= WHOLE_TEXT_LIMIT) return cut(text, 0, text.length, spans)

  const segments: QuoteSegment[] = []
  const windows = keptWindows(text, spans)
  windows.forEach((window, index) => {
    if (index === 0 && window.start > 0) {
      segments.push({ text: `${ELLIPSIS} `, highlighted: false })
    }
    segments.push(...cut(text, window.start, window.end, spans))
    // Between two windows the gap is marked once; after the last, only if text follows.
    if (index < windows.length - 1) {
      segments.push({ text: ` ${ELLIPSIS} `, highlighted: false })
    } else if (window.end < text.length) {
      segments.push({ text: ` ${ELLIPSIS}`, highlighted: false })
    }
  })
  return segments
}
