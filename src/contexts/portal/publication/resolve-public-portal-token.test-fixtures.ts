import type { ResolvePublicPortalTokenDeps } from './resolve-public-portal-token.server'

/** Reporters that discard and a media lookup that serves nothing, for reads that assert neither. */
export const quietGuestReadDeps: Pick<
  ResolvePublicPortalTokenDeps,
  | 'reportGoogleDestinationFailure'
  | 'reportApprovedDestinationFailure'
  | 'reportApprovedDestinationsDropped'
  | 'reportPortalMediaFailure'
  | 'resolvePortalMediaUrls'
> = {
  reportGoogleDestinationFailure: () => {},
  reportApprovedDestinationFailure: () => {},
  reportApprovedDestinationsDropped: () => {},
  reportPortalMediaFailure: () => {},
  resolvePortalMediaUrls: async () => ({}),
}
