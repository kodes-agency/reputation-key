import { describe, expect, it } from 'vitest'
import type { PortalReview } from '#/contexts/portal/application/public-api'
import { describePublishOutcome, describeReviewFooter } from './portal-review-footer'

type Facts = Parameters<typeof describeReviewFooter>[0]

const facts = (over: Partial<Facts> = {}): Facts => ({
  action: 'publish_changes',
  canPublish: true,
  nothingToPublish: false,
  publishesAsVersion: 6,
  checkCounts: { blocked: 0, warning: 0, passed: 7 },
  ...over,
})

describe('describeReviewFooter', () => {
  it('offers to publish changes to a live portal as the next version', () => {
    expect(describeReviewFooter(facts())).toEqual({
      versionLine: 'Publishes as version 6',
      note: 'Printed codes keep working',
      primary: { label: 'Publish changes', pendingLabel: 'Publishing…', disabled: false },
      hint: null,
    })
  })

  it('offers to publish a portal that is not live yet as its first version', () => {
    expect(
      describeReviewFooter(facts({ action: 'publish', publishesAsVersion: 1 })),
    ).toEqual({
      versionLine: 'Publishes as version 1',
      note: 'Printed codes start working',
      primary: { label: 'Publish portal', pendingLabel: 'Publishing…', disabled: false },
      hint: null,
    })
  })

  it('keeps the button but says what to fix first while a check is blocked', () => {
    const view = describeReviewFooter(
      facts({
        canPublish: false,
        checkCounts: { blocked: 2, warning: 0, passed: 5 },
      }),
    )

    expect(view.primary).toMatchObject({ disabled: true })
    expect(view.hint).toBe('Fix 2 things first')
    expect(
      describeReviewFooter(
        facts({ canPublish: false, checkCounts: { blocked: 1, warning: 0, passed: 6 } }),
      ).hint,
    ).toBe('Fix 1 thing first')
  })

  it('says there is nothing to publish when the live page already says what the draft says', () => {
    const view = describeReviewFooter(
      facts({ canPublish: false, nothingToPublish: true }),
    )

    expect(view.primary).toMatchObject({ label: 'Publish changes', disabled: true })
    expect(view.hint).toBe('Nothing to publish')
  })

  it('names a block before saying there is nothing to publish', () => {
    expect(
      describeReviewFooter(
        facts({
          canPublish: false,
          nothingToPublish: true,
          checkCounts: { blocked: 1, warning: 0, passed: 6 },
        }),
      ).hint,
    ).toBe('Fix 1 thing first')
  })

  it('does not offer a button the viewer cannot use', () => {
    const view = describeReviewFooter(facts({ canPublish: false }))

    expect(view.primary).toBeNull()
    expect(view.hint).toBe('You can’t publish this portal.')
  })

  it('offers nothing for a portal that cannot be published', () => {
    const none: PortalReview['action'] = 'none'

    expect(describeReviewFooter(facts({ action: none, canPublish: false }))).toEqual({
      versionLine: null,
      note: null,
      primary: null,
      hint: 'This portal is archived.',
    })
  })
})

describe('describePublishOutcome', () => {
  it('says which version is live now', () => {
    expect(describePublishOutcome({ outcome: 'published', version: 6 })).toBe(
      'Version 6 is live',
    )
  })

  it('says when there was nothing to publish', () => {
    expect(describePublishOutcome({ outcome: 'unchanged', version: 5 })).toBe(
      'Nothing to publish. Version 5 is already live.',
    )
  })

  it('says the portal is live after its first publication', () => {
    expect(describePublishOutcome(null)).toBe('The portal is published')
  })
})
