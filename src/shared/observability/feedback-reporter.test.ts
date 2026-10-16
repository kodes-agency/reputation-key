import { describe, expect, it } from 'vitest'
import { withFeedbackReporter } from './feedback-reporter'

const scrubbedFeedback = {
  type: 'feedback',
  contexts: {
    feedback: {
      message: 'The total row is missing.',
      source: 'repkey-native-beta-feedback',
    },
  },
  tags: { feedback_type: 'bug' },
}

describe('withFeedbackReporter', () => {
  it("names the report by the reporter's account", () => {
    const named = withFeedbackReporter({
      name: 'Bozhidar Denev',
      email: 'owner@example.com',
    })(scrubbedFeedback)

    expect(named).toEqual({
      ...scrubbedFeedback,
      contexts: {
        feedback: {
          message: 'The total row is missing.',
          source: 'repkey-native-beta-feedback',
          name: 'Bozhidar Denev',
          contact_email: 'owner@example.com',
        },
      },
    })
  })

  it('sends the email alone when the account has no name', () => {
    const named = withFeedbackReporter({ name: null, email: 'owner@example.com' })(
      scrubbedFeedback,
    ) as typeof scrubbedFeedback

    expect(named.contexts.feedback).toEqual({
      message: 'The total row is missing.',
      source: 'repkey-native-beta-feedback',
      contact_email: 'owner@example.com',
    })
  })

  it('folds whitespace in a name and keeps at most 120 characters', () => {
    const named = withFeedbackReporter({
      name: `  Ana\n  ${'b'.repeat(200)}  `,
      email: 'owner@example.com',
    })(scrubbedFeedback) as { contexts: { feedback: { name: string } } }

    expect(named.contexts.feedback.name).toBe(`Ana ${'b'.repeat(116)}`)
  })

  it('leaves out an email that is not shaped like one', () => {
    const named = withFeedbackReporter({ name: 'Ana', email: 'not an email' })(
      scrubbedFeedback,
    ) as { contexts: { feedback: Record<string, unknown> } }

    expect(named.contexts.feedback).not.toHaveProperty('contact_email')
    expect(named.contexts.feedback.name).toBe('Ana')
  })

  it('touches nothing but a feedback event', () => {
    const error = { type: undefined, exception: { values: [] } }

    expect(withFeedbackReporter({ name: 'Ana', email: 'ana@example.com' })(error)).toBe(
      error,
    )
  })
})
