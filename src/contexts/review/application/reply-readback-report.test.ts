import { describe, expect, it, vi } from 'vitest'
import { reportReplyReadback } from './reply-readback-report'

const ATTEMPT_TEXT = 'Thank you for staying with us.'

function report(overrides: Partial<Parameters<typeof reportReplyReadback>[1]> = {}) {
  const info = vi.fn()
  reportReplyReadback(
    { info },
    {
      source: 'publish_readback',
      reply: {
        text: ATTEMPT_TEXT,
        publicationCycle: 2,
        publicationAttempts: 3,
      },
      observedText: ATTEMPT_TEXT,
      moderation: {
        state: 'pending',
        policyViolation: null,
        commentPresent: true,
        updateTimePresent: false,
      },
      ...overrides,
    },
  )
  return info
}

describe('reportReplyReadback', () => {
  it('writes one structured line that finds the attempt and says what Google showed', () => {
    const info = report()

    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      {
        event: 'reply_publication_readback',
        source: 'publish_readback',
        publicationCycle: 2,
        attemptNumber: 3,
        moderationState: 'pending',
        commentPresent: true,
        updateTimePresent: false,
        textMatchedAttempt: true,
      },
      'Google reply read back for a publication attempt',
    )
  })

  it('names the reconcile sweep as its own source', () => {
    const info = report({ source: 'reconcile_sweep' })

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'reconcile_sweep' }),
      expect.any(String),
    )
  })

  it('carries the policy code of a REJECTED reply and no text', () => {
    const info = report({
      observedText: 'Not what we sent.',
      moderation: {
        state: 'rejected',
        policyViolation: 'SPAM',
        commentPresent: true,
        updateTimePresent: true,
      },
    })

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        moderationState: 'rejected',
        policyViolation: 'SPAM',
        textMatchedAttempt: false,
      }),
      expect.any(String),
    )
    const written = JSON.stringify(info.mock.calls)
    expect(written).not.toContain('Not what we sent')
    expect(written).not.toContain('staying with us')
    expect(written).not.toContain('"reason"')
  })

  it('reads a Google answer that predates the moderation fields as absent', () => {
    const info = report({ moderation: undefined, observedText: null })

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        moderationState: 'absent',
        commentPresent: false,
        textMatchedAttempt: false,
      }),
      expect.any(String),
    )
  })
})
