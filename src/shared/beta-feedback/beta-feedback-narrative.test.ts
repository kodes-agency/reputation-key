import { describe, expect, it } from 'vitest'
import { composeBetaFeedbackMessage, EMPTY_NARRATIVE } from './beta-feedback-narrative'

describe('beta feedback narrative', () => {
  it('labels each answered section of a bug report', () => {
    const message = composeBetaFeedbackMessage('bug', {
      context: 'Opening the Reviews page',
      observed: 'The page stayed empty',
      expected: 'The reviews should have appeared',
    })

    expect(message).toBe(
      [
        'What I was doing:\nOpening the Reviews page',
        'What happened:\nThe page stayed empty',
        'What I expected:\nThe reviews should have appeared',
      ].join('\n\n'),
    )
  })

  it('drops unanswered sections instead of emitting empty headings', () => {
    const message = composeBetaFeedbackMessage('bug', {
      ...EMPTY_NARRATIVE,
      observed: 'The page stayed empty',
    })

    expect(message).toBe('What happened:\nThe page stayed empty')
    expect(message).not.toContain('What I was doing')
    expect(message).not.toContain('What I expected')
  })

  it('treats whitespace-only answers as unanswered', () => {
    const message = composeBetaFeedbackMessage('bug', {
      context: '   \n  ',
      observed: 'The page stayed empty',
      expected: '\t',
    })

    expect(message).toBe('What happened:\nThe page stayed empty')
  })

  it('sends a suggestion as prose, with no bug headings', () => {
    const message = composeBetaFeedbackMessage('suggestion', {
      // A suggestion never collects these, but a stale value must not leak.
      context: 'stale context value',
      observed: '  Let me filter the inbox by property.  ',
      expected: 'stale expected value',
    })

    expect(message).toBe('Let me filter the inbox by property.')
    expect(message).not.toContain('stale')
  })
})
