import { describe, expect, it } from 'vitest'
import {
  GOOGLE_REPLY_COMMENT_MAX_BYTES,
  replyCommentByteLength,
  replyCommentProblem,
} from './reply-comment'

const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength

describe('replyCommentByteLength', () => {
  it('counts UTF-8 bytes, not UTF-16 units, for every width a reply can contain', () => {
    const samples = [
      '',
      'Thanks',
      'Благодарим ви!',
      'ありがとう',
      'Great stay 😀👍',
      'Hi,\n\nThanks\tbye\r\n',
    ]
    for (const sample of samples) {
      expect(replyCommentByteLength(sample)).toBe(utf8Bytes(sample))
    }
    expect(replyCommentByteLength('Б'.repeat(2_049))).toBe(4_098)
  })

  it('counts a lone surrogate as the three-byte replacement a UTF-8 encoder emits', () => {
    expect(replyCommentByteLength('a\uD800b')).toBe(utf8Bytes('a\uD800b'))
    expect(replyCommentByteLength('\uDC00')).toBe(3)
  })
})

describe('replyCommentProblem', () => {
  it('is 4096 bytes, the limit Google documents for a reply comment', () => {
    expect(GOOGLE_REPLY_COMMENT_MAX_BYTES).toBe(4_096)
  })

  it('accepts multi-line text with tabs and carriage returns', () => {
    expect(replyCommentProblem('Hi,\n\nThanks\tbye')).toBeNull()
    expect(replyCommentProblem('Line one\r\nLine two')).toBeNull()
  })

  it('refuses empty and whitespace-only text', () => {
    expect(replyCommentProblem('')).toBe('empty')
    expect(replyCommentProblem(' \n\t ')).toBe('empty')
  })

  it('draws the length line in bytes: 2048 Cyrillic letters fit, 2049 do not', () => {
    expect(replyCommentProblem('Б'.repeat(2_048))).toBeNull()
    expect(replyCommentProblem('Б'.repeat(2_049))).toBe('too_long')
    expect(replyCommentProblem('x'.repeat(4_096))).toBeNull()
    expect(replyCommentProblem('x'.repeat(4_097))).toBe('too_long')
  })

  it('refuses control characters other than line feed, carriage return and tab', () => {
    for (const control of ['\u0000', '\u0001', '\u000B', '\u001B', '\u001F', '\u007F']) {
      expect(replyCommentProblem(`Thanks${control}`)).toBe('invalid_character')
    }
  })

  it('refuses a lone surrogate but accepts a paired one', () => {
    expect(replyCommentProblem('Thanks \uD83D')).toBe('malformed_unicode')
    expect(replyCommentProblem('\uDE00 thanks')).toBe('malformed_unicode')
    expect(replyCommentProblem('Thanks 😀')).toBeNull()
  })
})
