/** Stable identity of the voice option set selected when a reply was framed. */
export type ReplyFrameBand =
  'positiveText' | 'positiveRatingOnly' | 'threeStar' | 'negative'

/** Numeric boundaries belong to the adopted Reply, never the strict provider contract. */
export type StoredReplyBodyFrame = Readonly<{
  bodyPrefixLength?: number
  bodySuffixLength?: number
}>

export function storedReplyFrame(
  text: string,
  choices: StoredReplyBodyFrame | null | undefined,
): Readonly<{ prefix: string; suffix: string }> | null {
  const prefix = choices?.bodyPrefixLength
  const suffix = choices?.bodySuffixLength
  if (
    typeof prefix !== 'number' ||
    typeof suffix !== 'number' ||
    !Number.isSafeInteger(prefix) ||
    !Number.isSafeInteger(suffix) ||
    prefix < 0 ||
    suffix < 0 ||
    prefix + suffix > text.length ||
    (prefix > 0 && text.slice(prefix, prefix + 2) !== '\n\n') ||
    (suffix > 0 && text.slice(-suffix - 2, -suffix) !== '\n\n')
  )
    return null
  return {
    prefix: text.slice(0, prefix),
    suffix: suffix === 0 ? '' : text.slice(-suffix),
  }
}

/** Track the textarea's contiguous edit, keeping local frame edits out of the body budget. */
export function editedReplyFrame(
  before: string,
  after: string,
  frame: Readonly<{ prefix: string; suffix: string }> | null,
): Readonly<{ prefix: string; suffix: string }> | null {
  if (!frame || !before.startsWith(frame.prefix) || !before.endsWith(frame.suffix))
    return null
  if (before === after) return frame
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start])
    start += 1
  let tail = 0
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - tail - 1] === after[after.length - tail - 1]
  )
    tail += 1
  const oldEnd = before.length - tail
  const newEnd = after.length - tail
  const delta = after.length - before.length
  const prefixEnd = editedPrefixEnd(start, oldEnd, frame.prefix.length, delta)
  const suffixStart = editedSuffixStart(
    start,
    oldEnd,
    newEnd,
    before.length - frame.suffix.length,
    delta,
  )
  return { prefix: after.slice(0, prefixEnd), suffix: after.slice(suffixStart) }
}

function editedPrefixEnd(
  start: number,
  end: number,
  boundary: number,
  delta: number,
): number {
  if (end <= boundary) return boundary + delta
  return start < boundary ? start : boundary
}
function editedSuffixStart(
  start: number,
  end: number,
  newEnd: number,
  boundary: number,
  delta: number,
): number {
  if (start >= boundary) return boundary
  return end > boundary ? newEnd : boundary + delta
}

export function framedReplyParts(
  text: string,
  frame: Readonly<{ prefix: string; suffix: string }> | null,
) {
  let body = text.trim()
  if (!frame || !body.startsWith(frame.prefix) || !body.endsWith(frame.suffix))
    return { prefix: '', body, suffix: '' }
  body = body.slice(frame.prefix.length).trim()
  if (frame.suffix) body = body.slice(0, -frame.suffix.length).trim()
  return { prefix: frame.prefix, body, suffix: frame.suffix }
}

/** The local voice is not part of the body word budget. */
export function replyBodyWords(
  text: string,
  frame: Readonly<{ prefix: string; suffix: string }> | null = null,
): number {
  const body = framedReplyParts(text, frame).body
  return body ? body.split(/\s+/u).length : 0
}
export const shorterReplyMaxWords = (words: number) =>
  Math.max(8, Math.floor(words * 0.6))
