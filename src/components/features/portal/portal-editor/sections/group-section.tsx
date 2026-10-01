// Group: which group the portal belongs to. Moving a portal between groups is
// done from the portals list until the group dialog lands, so this section says
// where the portal is and points there.

import { Link } from '@tanstack/react-router'
import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import type { PortalGroupView } from '../../portal-group/portal-group-types'

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
        <Link
          to="/properties/$propertyId/portals"
          params={{ propertyId }}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Manage groups on the portals list
        </Link>
      </div>
    </PortalEditorSectionFrame>
  )
}
