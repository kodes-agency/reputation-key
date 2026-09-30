// One tile in the list: its icon, its name and line, the languages it is
// written in, and a menu. Opening it shows the editor beneath.

import { useState, type ReactNode } from 'react'
import { Ellipsis } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { PortalLinktreeLink } from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { DeleteLinkDialog } from './delete-link-dialog'
import { LINK_ICONS, linkIconKeyOrDefault } from './link-icons'
import { LinktreeMoveControls } from './linktree-move-controls'
import { linkLabelFor, linkLocaleChips, type LinkMoveDirection } from './linktree-rules'

type Props = Readonly<{
  link: PortalLinktreeLink
  primaryLocale: GuestLocale
  locales: ReadonlyArray<GuestLocale>
  isOpen: boolean
  onToggle: () => void
  canEdit: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: LinkMoveDirection) => void
  onDelete: () => void
  /** The open tile's editor. */
  children: ReactNode
}>

export function LinktreeTile({
  link,
  primaryLocale,
  locales,
  isOpen,
  onToggle,
  canEdit,
  canMoveUp,
  canMoveDown,
  onMove,
  onDelete,
  children,
}: Props) {
  const [isConfirming, setIsConfirming] = useState(false)
  const { label, line } = linkLabelFor(link, primaryLocale)
  const name = label === '' ? 'Untitled link' : label
  const Icon = LINK_ICONS[linkIconKeyOrDefault(link.iconKey)]
  const panelId = `linktree-tile-${link.id}`

  return (
    <li className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
        {canEdit ? (
          <LinktreeMoveControls
            linkId={link.id}
            label={name}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMove={onMove}
          />
        ) : null}
        <span className="grid size-10 shrink-0 place-items-center rounded-md border bg-muted/40 text-muted-foreground">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
          className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="block truncate text-sm font-medium">{name}</span>
          {line === null ? null : (
            <span className="block truncate text-xs text-muted-foreground">{line}</span>
          )}
        </button>
        {locales.length > 1 ? (
          <ul aria-label="Languages" className="hidden shrink-0 gap-1.5 sm:flex">
            {linkLocaleChips(link, locales).map((chip) => (
              <li
                key={chip.locale}
                className={`text-xs ${chip.isMissing ? 'font-medium text-warn' : 'text-muted-foreground'}`}
              >
                {chip.chip}
                {chip.isMissing ? <span className="sr-only"> missing</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`More actions for ${name}`}
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onToggle}>
                {isOpen ? 'Close editor' : 'Edit'}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setIsConfirming(true)}
              >
                Delete link
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {isOpen ? (
        <div id={panelId} className="border-t p-4">
          {children}
        </div>
      ) : null}
      <DeleteLinkDialog
        open={isConfirming}
        onOpenChange={setIsConfirming}
        label={name}
        onDelete={onDelete}
      />
    </li>
  )
}
