import { describe, expect, it } from 'vitest'
import {
  aiReplyBrandProfile,
  digestAiReplyBrandDisplayName,
} from './ai-reply-brand-profile.server'

describe('AI Reply Brand Profile contract', () => {
  it('binds the exact approved display name through a domain-separated digest', () => {
    expect(aiReplyBrandProfile({ displayName: 'Example Hotel', version: 7 })).toEqual({
      displayName: 'Example Hotel',
      version: 7,
      displayNameDigest:
        '030c644bf71ad1d7570dc9ab6131f5209ac02fa65e930e2910778e024fc643bf',
    })
  })

  it.each([' Example Hotel', 'Example Hotel ', 'Example\u0000Hotel', 'Cafe\u0301'])(
    'rejects a non-canonical public display name (%j)',
    (displayName) => {
      expect(() => digestAiReplyBrandDisplayName(displayName)).toThrow(TypeError)
    },
  )
})
