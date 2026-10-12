// What the review page's footer says and offers. Pure: it reads the facts the
// review read already settled (`canPublish` is the same question the server
// asks before it publishes), so the button is never one the server refuses.

import type { PortalReview } from '#/contexts/portal/application/public-api'

export type ReviewFooterFacts = Pick<
  PortalReview,
  'action' | 'canPublish' | 'nothingToPublish' | 'publishesAsVersion' | 'checkCounts'
> &
  Readonly<{ live: Readonly<{ version: number }> | null }>

export type ReviewFooterView = Readonly<{
  /**
   * "Publishes as version 6", or "Version 5 is live · nothing waiting" when the
   * live page already says what the draft says; null for a portal that cannot
   * be published.
   */
  versionLine: string | null
  /** What publishing does to codes already printed. */
  note: string | null
  /** The publish button; null when the viewer is not offered one. */
  primary: Readonly<{ label: string; pendingLabel: string; disabled: boolean }> | null
  /**
   * "Back to editing" is the main action: there is nothing to publish, so the
   * way back is the one thing left to do, on every screen size.
   */
  backIsPrimary: boolean
  /** Why the button cannot be used, or why there is none. */
  hint: string | null
}>

const PENDING_LABEL = 'Publishing…'

const BUTTON: Readonly<Record<'publish' | 'publish_changes', string>> = {
  publish: 'Publish portal',
  publish_changes: 'Publish changes',
}

const NOTE: Readonly<Record<'publish' | 'publish_changes', string>> = {
  publish: 'Printed codes start working',
  publish_changes: 'Printed codes keep working',
}

const blockedHint = (count: number): string =>
  `Fix ${count} ${count === 1 ? 'thing' : 'things'} first`

export function describeReviewFooter(facts: ReviewFooterFacts): ReviewFooterView {
  const { action, canPublish, nothingToPublish, checkCounts, live } = facts
  if (action === 'none') {
    return {
      versionLine: null,
      note: null,
      primary: null,
      backIsPrimary: false,
      hint: 'This portal is archived.',
    }
  }
  // Nothing waits to go live: the version to be and what it does to printed
  // codes would describe a publication that cannot happen. A blocked check
  // still shows in Checks; it does not make a publication of nothing possible.
  if (nothingToPublish && live !== null) {
    return {
      versionLine: `Version ${live.version} is live · nothing waiting`,
      note: null,
      primary: null,
      backIsPrimary: true,
      hint: null,
    }
  }
  const shared = {
    versionLine: `Publishes as version ${facts.publishesAsVersion}`,
    note: NOTE[action],
    backIsPrimary: false,
  }
  const primary = (disabled: boolean) => ({
    label: BUTTON[action],
    pendingLabel: PENDING_LABEL,
    disabled,
  })
  if (canPublish) return { ...shared, primary: primary(false), hint: null }
  if (checkCounts.blocked > 0) {
    return { ...shared, primary: primary(true), hint: blockedHint(checkCounts.blocked) }
  }
  if (nothingToPublish) {
    return { ...shared, primary: primary(true), hint: 'Nothing to publish' }
  }
  return { ...shared, primary: null, hint: 'You can’t publish this portal.' }
}

/** The toast after a publication: which version is live, or that nothing changed. */
export function describePublishOutcome(
  result: Readonly<{ outcome: 'published' | 'unchanged'; version: number }>,
): string {
  return result.outcome === 'published'
    ? `Version ${result.version} is live`
    : `Nothing to publish. Version ${result.version} is already live.`
}
