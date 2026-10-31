import { describe, expect, it } from 'vitest'
import {
  storedReplyFrame,
  editedReplyFrame,
  replyBodyWords,
  shorterReplyMaxWords,
} from './reply-frame'

describe('adopted reply body boundaries', () => {
  it('recovers the saved voice after configuration changes without duplicating its text', () => {
    const prefix = 'Hello Anna 👋,'
    const suffix = 'Contact our team.\n\nKind regards,\nThe hotel'
    const text = `${prefix}\n\nA short body.\n\n${suffix}`
    expect(
      storedReplyFrame(text, {
        bodyPrefixLength: prefix.length,
        bodySuffixLength: suffix.length,
      }),
    ).toEqual({ prefix, suffix })
    expect(
      storedReplyFrame('Only the body.', { bodyPrefixLength: 0, bodySuffixLength: 0 }),
    ).toEqual({ prefix: '', suffix: '' })
  })
  it('rejects old lengths after a greeting or sign-off changes', () => {
    const prefix = 'Hello Anna,'
    const suffix = 'Kind regards, Our team'
    const original = `${prefix}\n\nThe body of the reply.\n\n${suffix}`
    const choices = { bodyPrefixLength: prefix.length, bodySuffixLength: suffix.length }
    expect(storedReplyFrame(original.replace('Anna', 'Alexandra'), choices)).toBeNull()
    expect(
      storedReplyFrame(original.replace('Our team', 'The management'), choices),
    ).toBeNull()
  })
  it('does not guess for historical or inconsistent metadata', () => {
    expect(storedReplyFrame('Body', null)).toBeNull()
    expect(storedReplyFrame('Body', {})).toBeNull()
    expect(
      storedReplyFrame('Body', { bodyPrefixLength: -1, bodySuffixLength: 0 }),
    ).toBeNull()
    expect(
      storedReplyFrame('Body', { bodyPrefixLength: 3, bodySuffixLength: 3 }),
    ).toBeNull()
    expect(
      storedReplyFrame('Body', { bodyPrefixLength: NaN, bodySuffixLength: 0 }),
    ).toBeNull()
  })
})

describe('current body frame after typing', () => {
  const frame = { prefix: 'Hello Anna,', suffix: 'Kind regards, Our team' }
  const before = `${frame.prefix}\n\nA short body.\n\n${frame.suffix}`
  it('tracks greeting, body and signature edits separately', () => {
    expect(editedReplyFrame(before, before.replace('Anna', 'Alexandra'), frame)).toEqual({
      ...frame,
      prefix: 'Hello Alexandra,',
    })
    expect(
      editedReplyFrame(before, before.replace('short', 'much longer'), frame),
    ).toEqual(frame)
    expect(
      editedReplyFrame(before, before.replace('Our team', 'The hotel management'), frame),
    ).toEqual({ ...frame, suffix: 'Kind regards, The hotel management' })
  })
  it('treats a completely replaced reply as a new body, retaining no old frame', () => {
    expect(editedReplyFrame(before, 'My replacement reply.', frame)).toEqual({
      prefix: '',
      suffix: '',
    })
    expect(editedReplyFrame(before, before, frame)).toBe(frame)
    expect(editedReplyFrame(before, before, null)).toBeNull()
  })
})

describe('reply body word budget', () => {
  it('budgets only the reply body and enforces the eight-word floor', () => {
    const frame = {
      prefix: 'Hello Anna,',
      suffix: 'Contact us.\nKind regards,\nThe team',
    }
    expect(
      replyBodyWords(
        `${frame.prefix}\n\nOne two three four five six seven eight nine ten.\n\n${frame.suffix}`,
        frame,
      ),
    ).toBe(10)
    expect(shorterReplyMaxWords(13)).toBe(8)
    expect(shorterReplyMaxWords(50)).toBe(30)
  })
  it('counts the whole text if its greeting or sign-off no longer matches the frame', () => {
    const text = 'Hello Alexandra,\n\nOne two three four five.\n\nRegards, The management'
    expect(
      replyBodyWords(text, { prefix: 'Hello Anna,', suffix: 'Regards, Our team' }),
    ).toBe(text.split(/\s+/u).length)
  })
})
