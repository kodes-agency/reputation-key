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

  // The AI draft purge leaves no draft behind, so its notice must not say the
  // reply was "returned to draft" or that anything is saved to approve again.
  it('says an unedited AI draft was removed, not returned, and that nothing was sent', () => {
    const rendered = renderNotification('reply.publication_cancelled', {
      propertyName: 'Riverside Hotel',
      publicationCancellationCause: 'ai_draft_withdrawn',
    })
    expect(rendered).toMatchObject({
      title: 'AI draft removed at Riverside Hotel',
      body: 'This was an AI draft nobody had edited, and the review, the property or its AI settings changed after it was written. RepKey sent nothing to Google and removed the draft. Write a new reply.',
      actionLabel: 'Open review',
    })
    expect(rendered.body).not.toMatch(/draft is saved|approve it again/)
  })

  it('does not claim non-delivery when an older notice carries no cause', () => {
    const rendered = renderNotification('reply.publication_cancelled', {})
    expect(rendered.body).not.toMatch(NON_DELIVERY)
  })
})
