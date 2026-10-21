import { describe, expect, it } from 'vitest'
import { NO_REPLY_MODERATION, replyReadbackFacts } from './reply-moderation'
import type { ReplyModeration } from './reply-moderation'

const ATTEMPT_TEXT = 'Thank you for staying with us.'

const moderation = (overrides: Partial<ReplyModeration> = {}): ReplyModeration => ({
  state: 'pending',
  policyViolation: null,
  commentPresent: true,
  updateTimePresent: true,
  ...overrides,
})

describe('replyReadbackFacts', () => {
  it('reports the state, what Google sent and whether the text is the attempt', () => {
    const facts = replyReadbackFacts({
      moderation: moderation(),
      observedText: ATTEMPT_TEXT,
      attemptText: ATTEMPT_TEXT,
    })

    expect(facts).toEqual({
      moderationState: 'pending',
      commentPresent: true,
      updateTimePresent: true,
      textMatchedAttempt: true,
    })
  })

  it('matches the way the observation authority does, ignoring whitespace noise', () => {
    const facts = replyReadbackFacts({
      moderation: moderation({ state: 'approved' }),
      observedText: `  ${ATTEMPT_TEXT}\r\n`,
      attemptText: ATTEMPT_TEXT,
    })

    expect(facts.textMatchedAttempt).toBe(true)
  })

  it('reports another text as not matching', () => {
    const facts = replyReadbackFacts({
      moderation: moderation({ state: 'approved' }),
      observedText: 'Someone else wrote this.',
      attemptText: ATTEMPT_TEXT,
    })

    expect(facts.textMatchedAttempt).toBe(false)
  })

  it('reports no text as not matching', () => {
    const facts = replyReadbackFacts({
      moderation: moderation({ commentPresent: false }),
      observedText: null,
      attemptText: ATTEMPT_TEXT,
    })

    expect(facts.textMatchedAttempt).toBe(false)
    expect(facts.commentPresent).toBe(false)
  })

  it('carries the policy code only for a REJECTED reply', () => {
    const rejected = replyReadbackFacts({
      moderation: moderation({ state: 'rejected', policyViolation: 'SPAM' }),
      observedText: ATTEMPT_TEXT,
      attemptText: ATTEMPT_TEXT,
    })
    const pending = replyReadbackFacts({
      moderation: moderation({ state: 'pending', policyViolation: 'SPAM' }),
      observedText: ATTEMPT_TEXT,
      attemptText: ATTEMPT_TEXT,
    })

    expect(rejected).toMatchObject({
      moderationState: 'rejected',
      policyViolation: 'SPAM',
    })
    expect(pending).not.toHaveProperty('policyViolation')
  })

  it('reads a read without moderation as absent', () => {
    const facts = replyReadbackFacts({
      moderation: undefined,
      observedText: null,
      attemptText: ATTEMPT_TEXT,
    })

    expect(facts.moderationState).toBe('absent')
    expect(NO_REPLY_MODERATION.state).toBe('absent')
  })

  it('never carries any reply text', () => {
    const facts = replyReadbackFacts({
      moderation: moderation({ state: 'rejected', policyViolation: 'SPAM' }),
      observedText: ATTEMPT_TEXT,
      attemptText: ATTEMPT_TEXT,
    })

    expect(JSON.stringify(facts)).not.toContain('Thank you')
    expect(Object.keys(facts)).not.toContain('reason')
  })
})
