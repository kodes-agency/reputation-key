// The import summary may not know how many imported reviews still need a
// reply: after its 15-minute wait for the Inbox it is sent without the count.
// "Unknown" must not read as "none" — telling a manager nothing is waiting
// when dozens of reviews are is worse than saying nothing about it.

import { describe, expect, it } from 'vitest'
import { renderNotification } from './notification-templates'

const summary = (unansweredCount?: number) =>
  renderNotification('property.review_import_finished', {
    importOutcome: 'completed',
    importedCount: 260,
    ...(unansweredCount === undefined ? {} : { unansweredCount }),
  }).body

describe('the import summary', () => {
  it('says nothing is waiting only when it knows none is', () => {
    expect(summary(0)).toBe('We imported 260 reviews. Nothing is waiting for a reply.')
  })

  it('does not claim nothing is waiting when the count is unknown', () => {
    expect(summary()).not.toMatch(/Nothing is waiting/)
    expect(summary()).toBe(
      'We imported 260 reviews. Open the inbox to see which still need a reply.',
    )
  })

  it('names how many still need a reply when it knows', () => {
    expect(summary(14)).toBe('We imported 260 reviews; 14 still need a reply.')
  })
})
