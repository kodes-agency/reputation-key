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
  live: { version: 5 },
  ...over,
})

describe('describeReviewFooter', () => {
  it('offers to publish changes to a live portal as the next version', () => {
    expect(describeReviewFooter(facts())).toEqual({
      versionLine: 'Publishes as version 6',
      note: 'Printed codes keep working',
      primary: { label: 'Publish changes', pendingLabel: 'Publishing…', disabled: false },
      backIsPrimary: false,
      hint: null,
    })
  })

  it('offers to publish a portal that is not live yet as its first version', () => {
    expect(
      describeReviewFooter(
        facts({ action: 'publish', publishesAsVersion: 1, live: null }),
      ),
    ).toEqual({
      versionLine: 'Publishes as version 1',
      note: 'Printed codes start working',
      primary: { label: 'Publish portal', pendingLabel: 'Publishing…', disabled: false },
      backIsPrimary: false,
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

  it('says which version is live and that nothing waits, with the way back as the action', () => {
    expect(
      describeReviewFooter(facts({ canPublish: false, nothingToPublish: true })),
    ).toEqual({
      versionLine: 'Version 5 is live · nothing waiting',
      note: null,
      primary: null,
      backIsPrimary: true,
      hint: null,
    })
  })

  it('does not promise a next version while nothing waits, even with a blocked check', () => {
    const view = describeReviewFooter(
      facts({
        canPublish: false,
        nothingToPublish: true,
        checkCounts: { blocked: 1, warning: 0, passed: 6 },
      }),
    )

    expect(view.versionLine).toBe('Version 5 is live · nothing waiting')
    expect(view.primary).toBeNull()
    expect(view.backIsPrimary).toBe(true)
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
      backIsPrimary: false,
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

  it('names the version a first publication makes live', () => {
    expect(describePublishOutcome({ outcome: 'published', version: 1 })).toBe(
      'Version 1 is live',
    )
  })
})
