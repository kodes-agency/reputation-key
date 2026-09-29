// A few notice types report where something ended up, not something that
// happened again. ADR 0046 r.2 still folds their events into one unread row,
// but the row must not say it repeated: a report accepted and then resolved,
// or an import that failed and then completed, did not happen twice.

import { describe, expect, it } from 'vitest'
import { renderNotification } from './notification-templates'

describe('a coalesced notice that reports where something ended up', () => {
  it('says only the latest report outcome, not that it happened twice', () => {
    const { body } = renderNotification('beta_feedback.outcome', {
      reportOutcome: 'resolved',
      occurrences: 2,
    })

    expect(body).not.toMatch(/times/)
    expect(body).toBe(
      renderNotification('beta_feedback.outcome', { reportOutcome: 'resolved' }).body,
    )
  })

  it('says only how the import ended, not that it ran twice', () => {
    const completed = {
      importOutcome: 'completed',
      importedCount: 260,
      unansweredCount: 40,
    } as const

    const { body } = renderNotification('property.review_import_finished', {
      ...completed,
      occurrences: 2,
    })

    expect(body).not.toMatch(/times/)
    expect(body).toBe(
      renderNotification('property.review_import_finished', completed).body,
    )
  })

  it('still counts a notice whose events really do repeat', () => {
    const { body } = renderNotification('review.updated', { occurrences: 3 })

    expect(body).toMatch(/Updated 3 times\./)
  })
})
