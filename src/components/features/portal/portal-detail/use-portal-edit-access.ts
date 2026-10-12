// `portalEditAccess` for the person on the page: their role's permission and
// the organisation's capability, read from the route context.

import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { PortalPublicationState } from '../shared/types'
import { portalEditAccess, type PortalEditAccess } from './portal-edit-access'

export function usePortalEditAccess(
  publicationState: PortalPublicationState,
): PortalEditAccess {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  return portalEditAccess({
    canUpdate: can('portal.update'),
    portalWriteEnabled: has('portal.write'),
    publicationState,
  })
}
