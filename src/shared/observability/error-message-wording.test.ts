import { describe, expect, it } from 'vitest'
import { errorMessageWording } from './error-message-wording'

const REDACTED = '[REDACTED]'

describe('errorMessageWording', () => {
  it.each([
    [
      'TypeError',
      "Cannot read properties of undefined (reading 'reviewerName')",
      'Cannot read properties of undefined (reading "…")',
    ],
    ['TypeError', 'replies.map is not a function', 'replies.map is not a function'],
    ['ReferenceError', 'portalConfig is not defined', 'portalConfig is not defined'],
    ['RangeError', 'Invalid time value', 'Invalid time value'],
    [
      'SyntaxError',
      'Unexpected token \'J\', "Jane Doe s"... is not valid JSON',
      'Unexpected token "…", "…"... is not valid JSON',
    ],
    [
      'TypeError',
      'Failed to fetch dynamically imported module: https://beta.example.invalid/assets/inbox-B1f6QYIB.js',
      'Failed to fetch dynamically imported module: <url>',
    ],
    ['TypeError', 'Failed to fetch', 'Failed to fetch'],
  ])('keeps the wording of a %s about the program: %s', (type, message, wording) => {
    expect(errorMessageWording(type, message)).toBe(wording)
  })

  it.each([
    [
      'an email address',
      'TypeError',
      'no account for guest@example.invalid',
      'no account for <email>',
    ],
    [
      'a phone number',
      'TypeError',
      'cannot dial +44 20 7946 0958 now',
      'cannot dial <number> now',
    ],
    [
      'an identifier',
      'TypeError',
      'no row 9b2f3c1e-8d4a-4f6b-9c2e-1a7d5e3f8b0c here',
      'no row <id> here',
    ],
    ['a key', 'TypeError', 'rejected sk_live_51Hq2pXk9mZtAbCdEfGh01', 'rejected <key>'],
    [
      'a file path',
      'TypeError',
      'Unable to preload /assets/x/y.css',
      'Unable to preload <path>',
    ],
  ])('removes %s', (_label, type, message, wording) => {
    expect(errorMessageWording(type, message)).toBe(wording)
  })

  it('keeps short numbers, which count things in the program', () => {
    expect(errorMessageWording('RangeError', 'Expected 3 arguments, got 12')).toBe(
      'Expected 3 arguments, got 12',
    )
  })

  it('keeps only the first line', () => {
    expect(
      errorMessageWording(
        'TypeError',
        'x is undefined\nparams: Jane Doe,guest@example.invalid',
      ),
    ).toBe('x is undefined')
  })

  it('keeps at most 200 characters', () => {
    expect(errorMessageWording('TypeError', `a${'b'.repeat(400)}`)).toHaveLength(200)
  })

  it.each([
    ['Error', 'the guest wrote that the room was cold'],
    ['DatabaseError', 'value too long for Jane Doe'],
    ['ZodError', '[{"path":["reviewText"]}]'],
    ['FeedbackError', 'Feedback could not be sent'],
    [undefined, 'Cannot read properties of undefined'],
  ])('replaces the whole message of a %s', (type, message) => {
    expect(errorMessageWording(type, message)).toBe(REDACTED)
  })

  it('replaces a message that is not text', () => {
    expect(errorMessageWording('TypeError', { text: 'x' })).toBe(REDACTED)
  })
})
