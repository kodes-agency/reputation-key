// The header's "Open page" slot: decides what to offer (`deriveOpenPageMode`)
// and reads the address the manager already holds from the workspace's
// issuance state, so a code made here opens with no reveal. Rendered inside
// `PortalLinkIssuanceProvider`, which is why the layout hands it over as an
// element rather than reading the state itself.

import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import type { PortalDetailTab } from '../portal-detail/portal-detail-rules'
import type { PortalShareMutations } from '../portal-share/portal-share-types'
import type { PortalPublicationState } from '../shared/types'
import { PortalOpenPageButton } from './portal-open-page-button'
import { deriveOpenPageMode } from './portal-open-page'
import { usePortalLinkIssuance } from './portal-link-issuance'

export type PortalOpenPageControlProps = Readonly<{
  propertyId: string
  portalId: string
  /** `portal.update`. */
  canUpdate: boolean
  /** The `portal.write` capability. */
  portalWriteEnabled: boolean
  publicationState: PortalPublicationState
  tokenStatus: PortalTokenStatus
  activeTab: PortalDetailTab
  revealMutation: PortalShareMutations['revealMutation']
}>

export function PortalOpenPageControl(props: PortalOpenPageControlProps) {
  const { issuedLink } = usePortalLinkIssuance()
  const heldAddress = issuedLink?.publicUrl ?? null
  const mode = deriveOpenPageMode({
    canUpdate: props.canUpdate,
    portalWriteEnabled: props.portalWriteEnabled,
    publicationState: props.publicationState,
    tokenStatus: props.tokenStatus,
    activeTab: props.activeTab,
    hasHeldAddress: heldAddress !== null,
  })
  if (mode === 'hidden') return null
  return (
    <PortalOpenPageButton
      propertyId={props.propertyId}
      portalId={props.portalId}
      mode={mode}
      heldAddress={heldAddress}
      revealMutation={props.revealMutation}
    />
  )
}
