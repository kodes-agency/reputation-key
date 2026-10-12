// The Portals page's header actions. From `sm` they are buttons in the header; on
// a phone, where they stood as two full rows above the first portal, the two
// secondary ones (Property look, New group) are one "more actions" menu beside the
// title and New portal waits in the bar at the bottom of the screen (board 11).
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { FolderPlus, Palette } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { RowActionsItem, RowActionsMenu } from '#/components/ui/row-actions-menu'

type Props = Readonly<{
  propertyId: string
  /** The role may read portals, so it may see the Property look. */
  showPropertyLook: boolean
  /** May make a group: a portal create with portal writes on. */
  onNewGroup: (() => void) | undefined
  /** New portal's button, or nothing; the page decides whether the phone bar repeats it. */
  newPortalButton: ReactNode
  /** The phone bar carries New portal, so the header's button waits for `sm`. */
  newPortalFromSm: boolean
}>

export function PortalListHeaderActions({
  propertyId,
  showPropertyLook,
  onNewGroup,
  newPortalButton,
  newPortalFromSm,
}: Props) {
  const hasSecondary = showPropertyLook || onNewGroup !== undefined
  return (
    <>
      {hasSecondary ? (
        <>
          <span className="hidden sm:contents">
            {showPropertyLook ? (
              <Button variant="outline" asChild>
                <Link to="/properties/$propertyId/portals/look" params={{ propertyId }}>
                  <Palette aria-hidden="true" />
                  Property look
                </Link>
              </Button>
            ) : null}
            {onNewGroup ? (
              <Button variant="outline" onClick={onNewGroup}>
                <FolderPlus aria-hidden="true" />
                New group
              </Button>
            ) : null}
          </span>
          <span className="sm:hidden">
            <RowActionsMenu name="portals" variant="outline">
              {showPropertyLook ? (
                <RowActionsItem asChild>
                  <Link to="/properties/$propertyId/portals/look" params={{ propertyId }}>
                    Property look
                  </Link>
                </RowActionsItem>
              ) : null}
              {onNewGroup ? (
                <RowActionsItem opensDialog onSelect={onNewGroup}>
                  New group
                </RowActionsItem>
              ) : null}
            </RowActionsMenu>
          </span>
        </>
      ) : null}
      {newPortalFromSm ? (
        <span className="hidden sm:contents">{newPortalButton}</span>
      ) : (
        newPortalButton
      )}
    </>
  )
}
