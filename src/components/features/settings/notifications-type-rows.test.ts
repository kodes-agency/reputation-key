import { describe, expect, it } from 'vitest'
import { NOTIFICATION_SETTINGS_CATEGORIES } from '#/contexts/feed/application/public-api'
import {
  CATEGORY_COPY,
  categoryDescription,
  categoryInSentence,
  settingsCategoriesFor,
} from './notifications-type-rows'

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

  // v3 contract decision 11: the Monday email is its own opt-in row.
  it('names the Monday email’s row for what it sends and when', () => {
    expect(CATEGORY_COPY.guest_voice.label).toBe('Guest voice summary')
    expect(CATEGORY_COPY.guest_voice.description).toBe(
      'Mondays at 8:00: what to fix first, what guests love and what changed. Nothing in a quiet week; a roundup on the first Monday of the month.',
    )
  })

  it('says an urgent review reaches the Action needed row', () => {
    expect(CATEGORY_COPY.urgent_operational.description).toContain('Urgent reviews')
  })

  it('writes a category in lower case inside a sentence', () => {
    expect(categoryInSentence('portal_goals')).toBe('portal goals')
    expect(categoryInSentence('workflow_collaboration')).toBe(
      'workflow and collaboration',
    )
    expect(categoryInSentence('arrivals')).toBe('new reviews and feedback')
    expect(categoryInSentence('guest_voice')).toBe('guest voice summary')
  })

  it('keeps Google a name inside a sentence', () => {
    expect(categoryInSentence('recognition')).toBe('Google rating goal')
  })

  // S4 (switch-on): what only v3 produces is offered only once v3 is on.
  describe('once review analysis v3 is on', () => {
    it('offers every category, the Guest voice summary and the Urgent reviews wording among them', () => {
      expect(settingsCategoriesFor(true)).toEqual(NOTIFICATION_SETTINGS_CATEGORIES)
      expect(categoryDescription('urgent_operational', true)).toContain('Urgent reviews')
      expect(categoryDescription('guest_voice', true)).toBe(
        CATEGORY_COPY.guest_voice.description,
      )
    })

    it('is what Settings offers now', () => {
      expect(settingsCategoriesFor()).toContain('guest_voice')
      expect(categoryDescription('urgent_operational')).toContain('Urgent reviews')
    })
  })

  describe('while it is not', () => {
    it('leaves out the Guest voice summary and keeps every other category in order', () => {
      expect(settingsCategoriesFor(false)).toEqual(
        NOTIFICATION_SETTINGS_CATEGORIES.filter((category) => category !== 'guest_voice'),
      )
    })

    it('does not name Urgent reviews in the Action needed row', () => {
      const text = categoryDescription('urgent_operational', false)
      expect(text).not.toContain('Urgent reviews')
      expect(text).toContain('escalations')
    })

    it('leaves every other description as it is', () => {
      expect(categoryDescription('low_ratings', false)).toBe(
        CATEGORY_COPY.low_ratings.description,
      )
    })
  })
})
