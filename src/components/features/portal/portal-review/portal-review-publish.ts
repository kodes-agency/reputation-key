// What the review page's Publish button does, apart from the route that wires
// it: which write a portal's publication is, what the manager is told, and where
// they go afterwards. Effects are passed in, so the branch choice and the words
// are pinned without a browser.

import type { PortalReview } from '#/contexts/portal/application/public-api'
import { describePublishOutcome } from './portal-review-footer'

export type ReviewPublishStep = 'publish_changes' | 'go_live'

/** A live portal replaces its live version; one that is not live goes live; an archived one does neither. */
export const reviewPublishStep = (
  action: PortalReview['action'],
): ReviewPublishStep | null => {
  if (action === 'publish_changes') return 'publish_changes'
  return action === 'publish' ? 'go_live' : null
}

export type ReviewPublishDeps = Readonly<{
  review: Pick<PortalReview, 'action' | 'publishesAsVersion'>
  portalId: string
  publishChanges: (input: { data: { portalId: string } }) => Promise<{
    outcome: 'published' | 'unchanged'
    version: number
  }>
  goLive: (input: {
    data: { portalId: string; publicationState: 'published' }
  }) => Promise<unknown>
  notify: Readonly<{
    success: (message: string) => void
    info: (message: string) => void
    error: (message: string) => void
  }>
  /** Back to editing, after a publication. */
  leave: () => Promise<void> | void
  /** Read the checks again: a refusal or a race means the page's facts are stale. */
  refreshReview: () => Promise<unknown> | void
  errorMessage: (error: unknown) => string
}>

/**
 * Publishes and reports. A publication leaves the page; a draft that already
 * matches the live version stays (nothing happened), and a refusal stays with the
 * checks read again so they say why the server refused.
 */
export async function publishReview(deps: ReviewPublishDeps): Promise<void> {
  const { review, portalId, notify } = deps
  const step = reviewPublishStep(review.action)
  if (step === null) return
  try {
    if (step === 'publish_changes') {
      const result = await deps.publishChanges({ data: { portalId } })
      notify[result.outcome === 'published' ? 'success' : 'info'](
        describePublishOutcome(result),
      )
      if (result.outcome === 'unchanged') {
        await deps.refreshReview()
        return
      }
    } else {
      await deps.goLive({ data: { portalId, publicationState: 'published' } })
      notify.success(
        describePublishOutcome({
          outcome: 'published',
          version: review.publishesAsVersion,
        }),
      )
    }
  } catch (error) {
    notify.error(deps.errorMessage(error))
    await deps.refreshReview()
    return
  }
  await deps.leave()
}
