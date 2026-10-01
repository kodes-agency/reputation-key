import { describe, expect, it, vi } from 'vitest'
import {
  publishReview,
  reviewPublishStep,
  type ReviewPublishDeps,
} from './portal-review-publish'

const PORTAL_ID = 'portal-1'

const setup = (over: Partial<ReviewPublishDeps> = {}) => {
  const deps = {
    review: { action: 'publish_changes', publishesAsVersion: 6 },
    portalId: PORTAL_ID,
    publishChanges: vi.fn(async () => ({ outcome: 'published' as const, version: 6 })),
    goLive: vi.fn(async () => ({ success: true })),
    notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
    leave: vi.fn(async () => undefined),
    refreshReview: vi.fn(async () => undefined),
    errorMessage: (error: unknown) => `refused: ${String(error)}`,
    ...over,
  } satisfies ReviewPublishDeps
  return deps
}

describe('reviewPublishStep', () => {
  it('publishes the changes of a live portal and takes a portal that is not live live', () => {
    expect(reviewPublishStep('publish_changes')).toBe('publish_changes')
    expect(reviewPublishStep('publish')).toBe('go_live')
  })

  it('has no step for a portal that cannot be published', () => {
    expect(reviewPublishStep('none')).toBeNull()
  })
})

describe('publishReview', () => {
  it('publishes a live portal’s changes, says which version is live and returns to editing', async () => {
    const deps = setup()

    await publishReview(deps)

    expect(deps.publishChanges).toHaveBeenCalledWith({ data: { portalId: PORTAL_ID } })
    expect(deps.goLive).not.toHaveBeenCalled()
    expect(deps.notify.success).toHaveBeenCalledWith('Version 6 is live')
    expect(deps.leave).toHaveBeenCalledTimes(1)
  })

  it('takes a portal that is not live live, naming the version it publishes as', async () => {
    const deps = setup({ review: { action: 'publish', publishesAsVersion: 1 } })

    await publishReview(deps)

    expect(deps.goLive).toHaveBeenCalledWith({
      data: { portalId: PORTAL_ID, publicationState: 'published' },
    })
    expect(deps.publishChanges).not.toHaveBeenCalled()
    expect(deps.notify.success).toHaveBeenCalledWith('Version 1 is live')
    expect(deps.leave).toHaveBeenCalledTimes(1)
  })

  it('stays on the page and says so when the draft already matches the live version', async () => {
    const deps = setup({
      publishChanges: vi.fn(async () => ({ outcome: 'unchanged' as const, version: 5 })),
    })

    await publishReview(deps)

    expect(deps.notify.info).toHaveBeenCalledWith(
      'Nothing to publish. Version 5 is already live.',
    )
    expect(deps.notify.success).not.toHaveBeenCalled()
    expect(deps.leave).not.toHaveBeenCalled()
    expect(deps.refreshReview).toHaveBeenCalledTimes(1)
  })

  it('reports a refusal in the server’s words, refreshes the checks and stays', async () => {
    const deps = setup({
      publishChanges: vi.fn(async () => {
        throw new Error('blocked')
      }),
    })

    await publishReview(deps)

    expect(deps.notify.error).toHaveBeenCalledWith('refused: Error: blocked')
    expect(deps.refreshReview).toHaveBeenCalledTimes(1)
    expect(deps.leave).not.toHaveBeenCalled()
    expect(deps.notify.success).not.toHaveBeenCalled()
  })

  it('reports a refused first publication the same way', async () => {
    const deps = setup({
      review: { action: 'publish', publishesAsVersion: 1 },
      goLive: vi.fn(async () => {
        throw new Error('no manager')
      }),
    })

    await publishReview(deps)

    expect(deps.notify.error).toHaveBeenCalledWith('refused: Error: no manager')
    expect(deps.refreshReview).toHaveBeenCalledTimes(1)
    expect(deps.leave).not.toHaveBeenCalled()
  })

  it('does nothing for a portal that cannot be published', async () => {
    const deps = setup({ review: { action: 'none', publishesAsVersion: 1 } })

    await publishReview(deps)

    expect(deps.publishChanges).not.toHaveBeenCalled()
    expect(deps.goLive).not.toHaveBeenCalled()
    expect(deps.notify.success).not.toHaveBeenCalled()
    expect(deps.notify.error).not.toHaveBeenCalled()
    expect(deps.leave).not.toHaveBeenCalled()
  })
})
