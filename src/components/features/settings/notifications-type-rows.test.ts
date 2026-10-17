import { describe, expect, it } from 'vitest'
import { CATEGORY_COPY, categoryInSentence } from './notifications-type-rows'

describe('notification category copy', () => {
  // ADR 0046, amended 2026-10-17: "Goals" split into one row per goal, so
  // muting the Google rating goal no longer silences a portal goal's results.
  it('names the two goal rows after their goals', () => {
    expect(CATEGORY_COPY.recognition).toEqual({
      label: 'Google rating goal',
      description: 'Changes to your Google rating goal.',
    })
    expect(CATEGORY_COPY.portal_goals).toEqual({
      label: 'Portal goals',
      description: 'Monthly results of your portal goals.',
    })
  })

  it('writes a category in lower case inside a sentence', () => {
    expect(categoryInSentence('portal_goals')).toBe('portal goals')
    expect(categoryInSentence('workflow_collaboration')).toBe(
      'workflow and collaboration',
    )
    expect(categoryInSentence('arrivals')).toBe('new reviews and feedback')
  })

  it('keeps Google a name inside a sentence', () => {
    expect(categoryInSentence('recognition')).toBe('Google rating goal')
  })
})
