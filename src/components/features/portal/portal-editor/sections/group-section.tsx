// Group: which group the portal belongs to. Groups are created, renamed and
// filled from the portals list (the group dialog and group page), so this
// section only says where the portal is and points there.

import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import type { PortalGroupView } from '../../portal-group/portal-group-types'
import { InlineLink } from '#/components/ui/inline-link'

export function GroupSection({
  propertyId,
  group,
}: Readonly<{ propertyId: string; group: PortalGroupView | null }>) {
  return (
    <PortalEditorSectionFrame
      section="group"
      description="Groups gather portals that share a goal or a results view."
    >
      <div className="space-y-3 rounded-md border px-4 py-3 text-sm">
        <p>
          {group ? (
            <>
              This portal is in <span className="font-medium">{group.name}</span>.
            </>
          ) : (
            'This portal is not in a group.'
          )}
        </p>
        <InlineLink to="/properties/$propertyId/portals" params={{ propertyId }}>
          Manage groups on the portals list
        </InlineLink>
      </div>
    </PortalEditorSectionFrame>
  )
}
