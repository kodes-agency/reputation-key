// What the review page's footer says and offers. Pure: it reads the facts the
// review read already settled (`canPublish` is the same question the server
// asks before it publishes), so the button is never one the server refuses.

import type { PortalReview } from '#/contexts/portal/application/public-api'

export type ReviewFooterFacts = Pick<
  PortalReview,
  'action' | 'canPublish' | 'nothingToPublish' | 'publishesAsVersion' | 'checkCounts'
>

export type ReviewFooterView = Readonly<{
  /** "Publishes as version 6"; null for a portal that cannot be published. */
  versionLine: string | null
  /** What publishing does to codes already printed. */
  note: string | null
  /** The publish button; null when the viewer is not offered one. */
  primary: Readonly<{ label: string; pendingLabel: string; disabled: boolean }> | null
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
  const { action, canPublish, nothingToPublish, checkCounts } = facts
  if (action === 'none') {
    return {
      versionLine: null,
      note: null,
      primary: null,
      hint: 'This portal is archived.',
    }
  }
  const shared = {
    versionLine: `Publishes as version ${facts.publishesAsVersion}`,
    note: NOTE[action],
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
