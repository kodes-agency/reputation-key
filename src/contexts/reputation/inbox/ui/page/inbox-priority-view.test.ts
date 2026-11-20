import { describe, expect, it } from 'vitest'
import type { InboxReviewAnalysis } from '#/contexts/inbox/application/public-api'
import {
  presentInboxPriority,
  prioritySuggestion,
  prioritySuggestionHint,
} from './inbox-priority-view'

const NOW = new Date('2026-10-28T12:00:00Z')
const TWO_HOURS_AGO = new Date('2026-10-28T10:00:00Z')
const OPTIONS = [{ userId: 'user-maria', name: 'Maria Lopez' }]
const VIEWER = { id: 'user-viewer', name: 'Ana Ruiz' }

const NOT_SET = {
  managerPriority: null,
  managerPrioritySetBy: null,
  managerPrioritySetAt: null,
} as const

const present = (
  item: Parameters<typeof presentInboxPriority>[0]['item'],
  suggestion: Parameters<typeof presentInboxPriority>[0]['suggestion'] = null,
) =>
  presentInboxPriority({
    item,
    suggestion,
    assignmentOptions: OPTIONS,
    currentUser: VIEWER,
    now: NOW,
  })

const setBy = (who: string, level: 'urgent' | 'high' | 'medium' | 'low' = 'low') => ({
  managerPriority: level,
  managerPrioritySetBy: who as never,
  managerPrioritySetAt: TWO_HOURS_AGO,
})

describe('presentInboxPriority', () => {
  it('reads "Priority", not set, when there is neither a level nor a suggestion', () => {
    expect(present(NOT_SET)).toMatchObject({
      level: null,
      isSuggested: false,
      word: 'Priority',
      accessibleName: 'Priority: not set',
      sourceLine: 'Not set',
      resetLabel: null,
      keepsWordWhenNarrow: false,
    })
  })

  it('shows the suggestion, tagged as suggested, while nobody has set a level', () => {
    expect(present(NOT_SET, 'high')).toMatchObject({
      level: 'high',
      isSuggested: true,
      setLevel: null,
      word: 'High',
      accessibleName: 'Priority: High, suggested',
      sourceLine: 'Suggested from review signals',
      resetLabel: null,
      keepsWordWhenNarrow: true,
    })
  })

  it("prints a person's level over the suggestion, with who and how long ago", () => {
    const view = present(setBy('user-maria', 'urgent'), 'low')

    expect(view).toMatchObject({
      level: 'urgent',
      isSuggested: false,
      setLevel: 'urgent',
      word: 'Urgent',
      accessibleName: 'Priority: Urgent',
      sourceLine: 'Set by Maria Lopez · 2h',
      resetLabel: 'Back to suggestion (Low)',
    })
  })

  it('names the viewer "you", and anyone the options do not hold "a manager"', () => {
    expect(present(setBy('user-viewer')).sourceLine).toBe('Set by you · 2h')
    expect(present(setBy('user-gone')).sourceLine).toBe('Set by a manager · 2h')
  })

  it('offers "Remove priority" when there is no suggestion to go back to', () => {
    expect(present(setBy('user-maria')).resetLabel).toBe('Remove priority')
  })

  it('keeps the word on a phone for Urgent and High only', () => {
    expect(present(setBy('user-maria', 'urgent')).keepsWordWhenNarrow).toBe(true)
    expect(present(setBy('user-maria', 'high')).keepsWordWhenNarrow).toBe(true)
    expect(present(setBy('user-maria', 'medium')).keepsWordWhenNarrow).toBe(false)
    expect(present(setBy('user-maria', 'low')).keepsWordWhenNarrow).toBe(false)
  })
})

describe('prioritySuggestion', () => {
  it("is a ready analysis' attention, and nothing for any other state", () => {
    const ready = {
      status: 'ready',
      sentiment: 'negative',
      aspects: [],
      primaryCategory: 'service',
      attention: 'urgent',
      generatedAtEpochMillis: 0,
    } as const satisfies InboxReviewAnalysis

    expect(prioritySuggestion(ready)).toBe('urgent')
    expect(prioritySuggestion({ status: 'disabled' })).toBeNull()
    expect(prioritySuggestion({ status: 'none' })).toBeNull()
    expect(
      prioritySuggestion({ status: 'unavailable', reason: 'language_not_supported' }),
    ).toBeNull()
    expect(prioritySuggestion(null)).toBeNull()
  })
})

describe('prioritySuggestionHint', () => {
  it("speaks only when a person's level and the suggestion disagree", () => {
    expect(prioritySuggestionHint('low', 'urgent')).toBe('Review signals suggest Urgent.')
    expect(prioritySuggestionHint('urgent', 'urgent')).toBeNull()
    expect(prioritySuggestionHint(null, 'urgent')).toBeNull()
    expect(prioritySuggestionHint('low', null)).toBeNull()
  })

  // Switch-on audit: since v3 is the only analysis, the suggestion is the v3 attention
  // (attention v2, which an Urgent reason lifts to urgent), not a blank "Not set".
  it("is a v3 analysis' attention too, an Urgent one included", () => {
    const readyV3 = (
      attention: 'low' | 'medium' | 'high' | 'urgent',
      urgentReason: 'safety' | null,
    ) =>
      ({
        status: 'ready_v3',
        analysisSequence: 3,
        sentiment: 'negative',
        attention,
        urgentReason,
        mentions: [],
        generatedAtEpochMillis: 0,
      }) as const satisfies InboxReviewAnalysis

    expect(prioritySuggestion(readyV3('high', null))).toBe('high')
    expect(prioritySuggestion(readyV3('urgent', 'safety'))).toBe('urgent')
    expect(prioritySuggestion(readyV3('low', null))).toBe('low')
  })
})
