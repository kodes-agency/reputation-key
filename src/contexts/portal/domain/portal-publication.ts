export const PORTAL_PUBLICATION_STATES = [
  'draft',
  'published',
  'disabled',
  'archived',
] as const
export type PortalPublicationState = (typeof PORTAL_PUBLICATION_STATES)[number]

export function isPortalPublicationState(value: string): value is PortalPublicationState {
  return (PORTAL_PUBLICATION_STATES as readonly string[]).includes(value)
}

export type PortalPublicationError = Readonly<{
  code: 'invalid_publication_transition'
  from: PortalPublicationState
  to: PortalPublicationState
}>

const transitions: Readonly<
  Record<PortalPublicationState, ReadonlySet<PortalPublicationState>>
> = {
  draft: new Set(['published', 'archived']),
  published: new Set(['disabled', 'archived']),
  disabled: new Set(['published', 'archived']),
  // Restore is deliberately non-public. A manager must re-check the retained
  // configuration and perform a separate Disabled -> Published transition.
  archived: new Set(['disabled']),
}

export function transitionPortalPublication(
  from: PortalPublicationState,
  to: PortalPublicationState,
): PortalPublicationState | PortalPublicationError {
  if (from === to) return from
  if (!transitions[from].has(to)) {
    return { code: 'invalid_publication_transition', from, to }
  }
  return to
}
