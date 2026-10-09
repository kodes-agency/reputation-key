// Linktree: the tiles shown under the rating card, the title above them, and
// the sites they are allowed to open. A tile is where an address is entered and,
// for an account admin, approved or turned off; the account admin's list of
// sites folds away below. Typed text saves as it is typed; re-ordering, icons,
// addresses, adding and deleting are each saved when made.

import { usePermissions } from '#/shared/hooks/usePermissions'
import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import { LinkTree } from '../../link-tree/link-tree'
import { linkApprovalControls } from '../../link-tree/link-approval-controls'
import { LinktreeSwitch } from '../../link-tree/linktree-switch'
import { useLinktreeMutations } from '../../link-tree/use-linktree-mutations'
import { PortalApprovedDestinationsEditor } from '../../portal-settings/portal-approved-destinations-editor'
import type { PortalEditorSectionProps } from '../portal-editor-types'

export function LinktreeSection({ resources, canEdit }: PortalEditorSectionProps) {
  const {
    portal,
    propertyId,
    linktree,
    responsibleManagerMembers,
    approvedDestinations,
    portalExperienceActions,
  } = resources
  const mutations = useLinktreeMutations(propertyId, portal.id)
  const { can } = usePermissions()
  // `deleteLink` asks for `portal.delete`, which a property manager does not hold.
  const canDelete = canEdit && can('portal.delete')
  const memberNames = new Map(
    (responsibleManagerMembers ?? []).map((member) => [member.userId, member.name]),
  )
  return (
    <PortalEditorSectionFrame
      section="linktree"
      description="Up to four tiles under the rating card. Changes save as you make them."
      actions={
        <LinktreeSwitch
          portalId={portal.id}
          enabled={linktree.enabled}
          save={mutations.saveSettings}
          disabled={!canEdit}
        />
      }
    >
      <LinkTree
        propertyId={propertyId}
        view={linktree}
        mutations={mutations}
        memberNames={memberNames}
        canEdit={canEdit}
        canDelete={canDelete}
        approval={linkApprovalControls(
          portal.id,
          approvedDestinations,
          portalExperienceActions,
          canEdit,
        )}
      />
      {approvedDestinations && portalExperienceActions ? (
        <PortalApprovedDestinationsEditor
          portalId={portal.id}
          state={approvedDestinations}
          actions={portalExperienceActions}
          disabled={!canEdit}
        />
      ) : null}
    </PortalEditorSectionFrame>
  )
}
