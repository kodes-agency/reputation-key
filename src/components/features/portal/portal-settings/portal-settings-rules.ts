// The publication decisions the settings section makes, as Records over the
// REAL domain union rather than as nested ternaries: adding a state to
// `PortalPublicationState` fails to compile here instead of quietly falling into
// an else arm that tells the manager the wrong thing about guest access.

import type { PortalPublicationState } from '../shared/types'

/**
 * What each state means for guests. `draft` and `disabled` read identically on
 * purpose — neither is reachable, and the manager's next action for both is to
 * publish. The old nested ternary tested `published` before `archived`; the two
 * can never collide (an archived portal is not published), so the Record is a
 * faithful transcription rather than a precedence change.
 */
export const PUBLICATION_DESCRIPTIONS: Record<PortalPublicationState, string> = {
  draft: 'The public page is unavailable until you publish it.',
  published: 'Guests with the link can open this portal.',
  disabled: 'The public page is unavailable until you publish it.',
  archived: 'This portal is archived. Its configuration and history are retained.',
}

type PublicationToggle = Readonly<{
  label: string
  /** The state the single toggle click transitions to. */
  nextState: PortalPublicationState
  variant: 'default' | 'outline'
}>

/**
 * The one-click publication transition offered for each state, or `null` where
 * there is none. Archival is terminal in this UI — un-archiving is not a
 * manager affordance — so `archived` carries no toggle at all rather than a dead
 * entry that a future edit could accidentally start rendering.
 *
 * Only `published` earns the outlined button: it is the one state whose action
 * takes access away, so it must not read as the primary thing to do here.
 */
export const PUBLICATION_TOGGLES: Record<
  PortalPublicationState,
  PublicationToggle | null
> = {
  draft: { label: 'Publish portal', nextState: 'published', variant: 'default' },
  published: {
    label: 'Disable public page',
    nextState: 'disabled',
    variant: 'outline',
  },
  disabled: { label: 'Publish portal', nextState: 'published', variant: 'default' },
  archived: null,
}

/**
 * The settings live region. An in-flight save takes precedence over the last
 * successful one, so a second save is never announced as already finished; once
 * neither holds there is nothing to announce and the region stays empty.
 */
export function saveStatusMessage(isPending: boolean, isSuccess: boolean): string {
  if (isPending) return 'Saving portal settings'
  return isSuccess ? 'Portal settings saved' : ''
}
