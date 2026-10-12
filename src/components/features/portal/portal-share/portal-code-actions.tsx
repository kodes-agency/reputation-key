// The "…" menu on the code block: replace the code, or stop every code. Each
// opens its own dialog, held here (outside the menu) so the dialog survives the
// menu closing. The dialog opens only after the menu has closed and handed focus
// back to its button: opened in the same tick, the menu's focus trap pulls focus
// off the dialog's first field, and the dialog then returns focus to nothing.

import { useRef, useState } from 'react'
import { RefreshCw, ShieldX } from 'lucide-react'
import {
  RowActionsItem,
  RowActionsMenu,
  RowActionsSeparator,
} from '#/components/ui/row-actions-menu'
import { PortalReplaceCodeDialog } from './portal-replace-code-dialog'
import { PortalStopCodesDialog } from './portal-stop-codes-dialog'
import type { IssuedPortalLink, PortalShareMutations } from './portal-share-types'

type OpenDialog = 'replace' | 'stop' | null

type Props = Readonly<{
  portalId: string
  isPending: boolean
  rotateMutation: PortalShareMutations['rotateMutation']
  revokeMutation: PortalShareMutations['revokeMutation']
  onLinkIssued: (link: IssuedPortalLink) => void
  onLinksRevoked: () => void
}>

export function PortalCodeActions(props: Props) {
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null)
  const chosen = useRef<OpenDialog>(null)
  const close = (open: boolean) => {
    if (!open) setOpenDialog(null)
  }

  return (
    <>
      <RowActionsMenu
        name="the code"
        variant="outline"
        width="wide"
        disabled={props.isPending}
        onCloseAutoFocus={() => {
          setOpenDialog(chosen.current)
          chosen.current = null
        }}
      >
        <RowActionsItem
          icon={RefreshCw}
          opensDialog
          description="Planned, or at once for security"
          onSelect={() => {
            chosen.current = 'replace'
          }}
        >
          Replace code
        </RowActionsItem>
        <RowActionsSeparator />
        <RowActionsItem
          icon={ShieldX}
          destructive
          opensDialog
          description="Turn off the public address at once"
          onSelect={() => {
            chosen.current = 'stop'
          }}
        >
          Stop all codes
        </RowActionsItem>
      </RowActionsMenu>

      <PortalReplaceCodeDialog
        open={openDialog === 'replace'}
        onOpenChange={close}
        portalId={props.portalId}
        mutation={props.rotateMutation}
        onLinkIssued={props.onLinkIssued}
      />
      <PortalStopCodesDialog
        open={openDialog === 'stop'}
        onOpenChange={close}
        portalId={props.portalId}
        mutation={props.revokeMutation}
        onStopped={props.onLinksRevoked}
      />
    </>
  )
}
