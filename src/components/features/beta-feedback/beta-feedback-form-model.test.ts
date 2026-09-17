import { describe, expect, it } from 'vitest'
import { betaFeedbackInputSchema } from '#/shared/beta-feedback-contract'
import {
  betaFeedbackFormSchema,
  emptyBetaFeedbackForm,
  impactForType,
  impactOptionsFor,
  toBetaFeedbackInput,
} from './beta-feedback-form-model'

const ROUTE = { routePath: '/inbox', viewport: 'regular' } as const
const EVENT_ID = 'a'.repeat(32)

function values(overrides: Partial<Record<string, unknown>> = {}) {
  return betaFeedbackFormSchema.parse({
    ...emptyBetaFeedbackForm,
    observed: 'The page stayed empty',
    ...overrides,
  })
}

describe('beta feedback form model', () => {
  it('produces input the wire contract accepts', () => {
    const input = toBetaFeedbackInput(values(), ROUTE, null)

    expect(() => betaFeedbackInputSchema.parse(input)).not.toThrow()
    expect(input.clientErrorEventId).toBeNull()
  })

  it('attaches a recorded error only when the reporter opted in', () => {
    expect(
      toBetaFeedbackInput(values({ includeRecordedError: true }), ROUTE, EVENT_ID)
        .clientErrorEventId,
    ).toBe(EVENT_ID)
    expect(
      toBetaFeedbackInput(values({ includeRecordedError: false }), ROUTE, EVENT_ID)
        .clientErrorEventId,
    ).toBeNull()
  })

  it('does not attach an error that was never recorded', () => {
    expect(
      toBetaFeedbackInput(values({ includeRecordedError: true }), ROUTE, null)
        .clientErrorEventId,
    ).toBeNull()
  })

  it('never attaches an error to a suggestion, even if opted in', () => {
    // The contract rejects this pairing outright, so the fold must not build it.
    const input = toBetaFeedbackInput(
      values({ kind: 'suggestion', impact: 'helpful', includeRecordedError: true }),
      ROUTE,
      EVENT_ID,
    )

    expect(input.clientErrorEventId).toBeNull()
    expect(() => betaFeedbackInputSchema.parse(input)).not.toThrow()
  })

  it('offers each type only its own impact scale', () => {
    expect(impactOptionsFor('bug').map((option) => option.value)).toEqual([
      'cannot_complete',
      'workaround_available',
      'small_issue',
    ])
    expect(impactOptionsFor('suggestion').map((option) => option.value)).toEqual([
      'important',
      'helpful',
      'nice_to_have',
    ])
  })

  it('moves an impact that does not survive a type switch', () => {
    expect(impactForType('suggestion', 'cannot_complete')).toBe('helpful')
    expect(impactForType('bug', 'nice_to_have')).toBe('workaround_available')
  })

  it('keeps an impact that is valid for the new type', () => {
    expect(impactForType('bug', 'small_issue')).toBe('small_issue')
    expect(impactForType('suggestion', 'important')).toBe('important')
  })

  it('requires something to have been described', () => {
    expect(() => values({ observed: '  ' })).toThrow()
  })
})
