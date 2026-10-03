// The "…" menu on the code block: replace the code, or stop every code. Each
// opens its own dialog, held here (outside the menu) so the dialog survives the
// menu closing. The dialog opens only after the menu has closed and handed focus
// back to its button: opened in the same tick, the menu's focus trap pulls focus
// off the dialog's first field, and the dialog then returns focus to nothing.

import { useRef, useState } from 'react'
import { Ellipsis, RefreshCw, ShieldX } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { PortalReplaceCodeDialog } from './portal-replace-code-dialog'
import { PortalStopCodesDialog } from './portal-stop-codes-dialog'
import type { IssuedPortalLink, PortalShareMutations } from './portal-share-types'
import { IconButton } from '#/components/ui/icon-button'

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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            variant="outline"
            label="More code actions"
            tooltip={false}
            disabled={props.isPending}
          >
            <Ellipsis />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-72"
          onCloseAutoFocus={() => {
            setOpenDialog(chosen.current)
            chosen.current = null
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              chosen.current = 'replace'
            }}
          >
            <RefreshCw />
            <span className="flex flex-col">
              <span>Replace code…</span>
              <span className="text-xs text-muted-foreground">
                Planned, or at once for security
              </span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              chosen.current = 'stop'
            }}
          >
            <ShieldX />
            <span className="flex flex-col">
              <span>Stop all codes…</span>
              <span className="text-xs text-muted-foreground">
                Turn off the public address at once
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
