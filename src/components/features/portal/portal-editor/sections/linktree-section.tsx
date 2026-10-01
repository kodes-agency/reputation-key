// Linktree: the tiles shown under the rating card, the title above them, and
// the destinations they are allowed to open. Typed text saves as it is typed;
// re-ordering, icons, addresses, adding and deleting are each saved when made.

import { usePermissions } from '#/shared/hooks/usePermissions'
import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import { LinkTree } from '../../link-tree/link-tree'
import { LinktreeSwitch } from '../../link-tree/linktree-switch'
import { useLinktreeMutations } from '../../link-tree/use-linktree-mutations'
import { PortalApprovedDestinationsEditor } from '../../portal-settings/portal-approved-destinations-editor'
import type { PortalEditorSectionProps } from '../portal-editor-types'

export function LinktreeSection({ resources, canEdit }: PortalEditorSectionProps) {
  const {
    portal,
    linktree,
    responsibleManagerMembers,
    approvedDestinations,
    portalExperienceActions,
  } = resources
  const mutations = useLinktreeMutations(portal.id)
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
        view={linktree}
        mutations={mutations}
        memberNames={memberNames}
        canEdit={canEdit}
        canDelete={canDelete}
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
