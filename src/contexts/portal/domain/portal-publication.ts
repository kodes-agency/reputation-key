export type PortalPublicationState = 'draft' | 'published' | 'disabled' | 'archived'

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
  archived: new Set(),
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

export function isPubliclyAvailable(state: PortalPublicationState): boolean {
  return state === 'published'
}
