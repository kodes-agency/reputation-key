// Plain-text part composition.
//
// The text/plain alternative is not optional and it is not stripped HTML: an
// HTML-only message scores badly with spam filters, is unreadable in a
// text-only client, and is what most screen-reader users of Mail actually get.
// Every renderer therefore hand-writes its text twin and joins it here.
//
// This module also exists because the digest previously joined its items with
// the string `'\\n'` — an escaped backslash-n that rendered as literal `\n`
// characters in the reader's inbox. Blocks go in as separate arguments and come
// out separated by real newlines; there is no place to put an escape sequence.

/** A text block, or a falsy placeholder for a section that does not apply. */
export type TextBlock = string | false | null | undefined

/**
 * Join text blocks into a plain-text email body.
 *
 * Empty and falsy blocks drop out, each block is trimmed, runs of three or more
 * newlines collapse to a paragraph break, and the result ends with exactly one
 * newline so appended clients do not glue the signature to the last line.
 */
export const composeText = (...blocks: ReadonlyArray<TextBlock>): string => {
  const body = blocks
    .filter((block): block is string => typeof block === 'string' && block.trim() !== '')
    .map((block) => block.replace(/\r\n/g, '\n').trim())
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
  return body === '' ? '' : `${body}\n`
}

/** Join facts onto one line with the middot separator the HTML part uses. */
export const textFacts = (...parts: ReadonlyArray<TextBlock>): string =>
  parts
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' · ')
