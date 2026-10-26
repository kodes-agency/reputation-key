// `portalEditAccess` for the person on the page: the Portals pages' role and
// capability rule, plus this portal's state.

import { usePortalAccess } from '../portal-overview/use-portal-access'
import type { PortalPublicationState } from '../shared/types'
import { portalEditAccess, type PortalEditAccess } from './portal-edit-access'

export function usePortalEditAccess(
  publicationState: PortalPublicationState,
): PortalEditAccess {
  return portalEditAccess(usePortalAccess(), publicationState)
}
