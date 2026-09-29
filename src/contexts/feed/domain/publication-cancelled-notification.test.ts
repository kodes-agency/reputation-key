import { describe, expect, it } from 'vitest'
import { renderNotification } from './notification-templates'

const NON_DELIVERY = /never (sent|went out)/

// A guest edit and a different live reply both stop cycles Google may already
// hold (sending, pending_observation, ambiguous), so their notice must never
// claim the reply was not sent: the team would redo work the guest has seen.
describe('reply.publication_cancelled copy', () => {
  it('does not claim a reply stopped by a guest edit was never sent', () => {
    const rendered = renderNotification('reply.publication_cancelled', {
      propertyName: 'Riverside Hotel',
      publicationCancellationCause: 'source_changed',
    })
    expect(rendered.body).toBe(
      'The guest changed their review, so RepKey stopped publishing the approved text. Open it to check what Google shows, then reply to the new review.',
    )
  })

  it('does not claim a reply overtaken by a different live reply was never sent', () => {
    const rendered = renderNotification('reply.publication_cancelled', {
      publicationCancellationCause: 'provider_truth',
    })
    expect(rendered.body).toBe(
      'A different reply is live on Google, so this one is not. Open it to check.',
    )
  })

  it('does not claim non-delivery when an older notice carries no cause', () => {
    const rendered = renderNotification('reply.publication_cancelled', {})
    expect(rendered.body).not.toMatch(NON_DELIVERY)
  })
})
