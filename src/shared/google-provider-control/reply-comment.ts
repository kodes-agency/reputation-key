/**
 * The one rule for what Google can be sent as a review reply comment.
 *
 * Every layer that accepts, stores, counts or sends reply text asks this
 * module, so a reply the manager can approve is a reply the provider route
 * can compile. Before this rule existed the domain capped text at 4096 UTF-16
 * units while the route capped the body at 4096 UTF-8 bytes and refused line
 * feeds, so a three-paragraph reply and a 2049-letter Cyrillic reply were both
 * approved and then refused inside the worker (route-catalogue.ts reviews.reply).
 *
 * Pure and dependency-free: it runs in the browser (the composer's counter),
 * in the server DTOs and in the provider route catalogue, so it measures bytes
 * without `Buffer`.
 */

/** Google documents the reply comment limit as 4096 bytes. */
export const GOOGLE_REPLY_COMMENT_MAX_BYTES = 4096

export type ReplyCommentProblem =
  'empty' | 'too_long' | 'invalid_character' | 'malformed_unicode'

const LINE_FEED = 0x0a
const CARRIAGE_RETURN = 0x0d
const TAB = 0x09
const LAST_C0_CONTROL = 0x1f
const DELETE = 0x7f

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff

/**
 * UTF-8 byte length, matching `TextEncoder`: a lone surrogate counts as the
 * three-byte U+FFFD an encoder substitutes for it.
 */
export function replyCommentByteLength(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index)
    if (unit < 0x80) {
      bytes += 1
    } else if (unit < 0x800) {
      bytes += 2
    } else if (isHighSurrogate(unit) && isLowSurrogate(text.charCodeAt(index + 1))) {
      bytes += 4
      index += 1
    } else {
      bytes += 3
    }
  }
  return bytes
}

/**
 * A code point Google's JSON body cannot carry as reply text. JSON.stringify
 * escapes every C0 control safely, so line feed, carriage return and tab — the
 * ones a person types — are allowed; the rest (NUL, ESC, …) and DEL are not
 * text anyone meant to publish.
 */
function isRefusedControl(unit: number): boolean {
  if (unit === LINE_FEED || unit === CARRIAGE_RETURN || unit === TAB) return false
  return unit <= LAST_C0_CONTROL || unit === DELETE
}

function characterProblem(text: string): ReplyCommentProblem | null {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index)
    if (isHighSurrogate(unit)) {
      if (!isLowSurrogate(text.charCodeAt(index + 1))) return 'malformed_unicode'
      index += 1
    } else if (isLowSurrogate(unit)) {
      return 'malformed_unicode'
    } else if (isRefusedControl(unit)) {
      return 'invalid_character'
    }
  }
  return null
}

/** null when Google can be sent this text as a reply comment. */
export function replyCommentProblem(text: string): ReplyCommentProblem | null {
  if (text.trim().length === 0) return 'empty'
  // A character problem wins over length: shortening the reply would not fix it.
  const character = characterProblem(text)
  if (character !== null) return character
  if (replyCommentByteLength(text) > GOOGLE_REPLY_COMMENT_MAX_BYTES) return 'too_long'
  return null
}
