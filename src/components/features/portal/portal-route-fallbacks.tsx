import type { ReactNode } from 'react'
import type { ErrorComponentProps } from '@tanstack/react-router'

import { PageHeader } from '#/components/layout/page-header'
import { FullBleedFrame, PageShell } from '#/components/layout/page-shell'
import { ErrorState, LoadingState } from '#/components/layout/page-states'
import {
  SignedOutRedirect,
  useGuardedRouteError,
} from '#/components/layout/use-guarded-route-error'

// Each error component keeps its page's frame (title, description, tier) and
// takes everything else from `useGuardedRouteError`: the sanitised message, the
// capture, the 401 sign-in redirect and Try again. The sentence below is the
// page's own, shown where the raw message may not be.
const PORTALS_NOT_LOADED = 'Portals could not be loaded.'
const PORTAL_NOT_LOADED = 'This portal could not be loaded.'

export function PortalListLoading() {
  return (
    <PageShell>
      <LoadingState label="Loading portals and portal groups" />
    </PageShell>
  )
}

export function PortalListError({ error }: ErrorComponentProps) {
  const guarded = useGuardedRouteError(error, PORTALS_NOT_LOADED)
  if (guarded.signedOut) return <SignedOutRedirect />
  return (
    <PageShell>
      <PageHeader title="Portals" description="Manage this property’s public pages." />
      <ErrorState message={guarded.message} onRetry={guarded.retry} />
    </PageShell>
  )
}

/** The All properties page's own: its Portals are the Organization's, not one Property's. */
export function PortalAllPropertiesError({ error }: ErrorComponentProps) {
  const guarded = useGuardedRouteError(error, PORTALS_NOT_LOADED)
  if (guarded.signedOut) return <SignedOutRedirect />
  return (
    <PageShell>
      <PageHeader
        title="Portals"
        description="Public pages across all of your properties."
      />
      <ErrorState message={guarded.message} onRetry={guarded.retry} />
    </PageShell>
  )
}

/**
 * The portal workspace is full-bleed (see `isFullBleedRoute`): the layout above
 * it clips overflow and pads nothing. Its loading, error and not-found states
 * render in that same frame, so they bring their own padding and their own
 * scroll instead of being cut off at the viewport.
 */
export function PortalFallbackFrame({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <FullBleedFrame scroll>
      <PageShell>{children}</PageShell>
    </FullBleedFrame>
  )
}

export function PortalDetailLoading() {
  return (
    <PortalFallbackFrame>
      <LoadingState label="Loading portal details" />
    </PortalFallbackFrame>
  )
}

export function PortalDetailError({ error }: ErrorComponentProps) {
  const guarded = useGuardedRouteError(error, PORTAL_NOT_LOADED)
  if (guarded.signedOut) return <SignedOutRedirect />
  return (
    <PortalFallbackFrame>
      <PageHeader title="Portal" description="Manage this property’s public page." />
      <ErrorState message={guarded.message} onRetry={guarded.retry} />
    </PortalFallbackFrame>
  )
}
