// One tile in the list: its icon, its name and line, the languages it is
// written in, and a menu. Opening it shows the editor beneath. A tile guests
// cannot see (its address is not approved) says so on the row itself, in warning
// ink; an approved tile stays quiet.

import { useState, type ReactNode } from 'react'
import { CircleAlert, EyeOff } from 'lucide-react'
import { RowActionsItem, RowActionsMenu } from '#/components/ui/row-actions-menu'
import type { PortalLinktreeLink } from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { DeleteLinkDialog } from './delete-link-dialog'
import { LINK_ICONS, linkIconKeyOrDefault } from './link-icons'
import { describeHiddenFromGuests } from './linktree-approval-rules'
import { LinktreeMoveControls } from './linktree-move-controls'
import { linkPhotoUrl } from './linktree-photo-rules'
import {
  describeMissingLanguages,
  linkLabelFor,
  linkLocaleChips,
  type LinkMoveControl,
  type LinkMoveDirection,
} from './linktree-rules'

type Props = Readonly<{
  link: PortalLinktreeLink
  primaryLocale: GuestLocale
  locales: ReadonlyArray<GuestLocale>
  isOpen: boolean
  onToggle: () => void
  canEdit: boolean
  /** Deleting needs a permission editing does not (account admins only). */
  canDelete: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: LinkMoveDirection, control: LinkMoveControl) => void
  /** Resolves when the link is deleted; a rejection stays in the confirmation. */
  onDelete: () => Promise<unknown>
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
  canDelete,
  canMoveUp,
  canMoveDown,
  onMove,
  onDelete,
  children,
}: Props) {
  const [isConfirming, setIsConfirming] = useState(false)
  const { label, line } = linkLabelFor(link, primaryLocale)
  const name = label === '' ? 'Untitled link' : label
  const chips = linkLocaleChips(link, locales)
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
        <TileThumbnail link={link} />
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
          <TileMarkers
            phoneChip={describeMissingLanguages(chips)}
            hiddenNote={describeHiddenFromGuests(link.destination)}
          />
        </button>
        {locales.length > 1 ? <LanguageChips chips={chips} /> : null}
        {canEdit ? (
          <LinktreeActionsMenu
            name={name}
            isOpen={isOpen}
            canDelete={canDelete}
            onToggle={onToggle}
            onDelete={() => setIsConfirming(true)}
          />
        ) : null}
      </div>
      {isOpen ? (
        <div id={panelId} className="border-t p-4">
          {children}
        </div>
      ) : null}
      {canDelete ? (
        <DeleteLinkDialog
          open={isConfirming}
          onOpenChange={setIsConfirming}
          label={name}
          onDelete={onDelete}
        />
      ) : null}
    </li>
  )
}

/** The tile's photo, or its icon in a box. */
function TileThumbnail({ link }: Readonly<{ link: PortalLinktreeLink }>) {
  const photoUrl = linkPhotoUrl(link)
  if (photoUrl !== null) {
    return (
      <img
        src={photoUrl}
        alt=""
        width={40}
        height={40}
        className="size-10 shrink-0 rounded-md border object-cover"
      />
    )
  }
  const Icon = LINK_ICONS[linkIconKeyOrDefault(link.iconKey)]
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-md border bg-muted/40 text-muted-foreground">
      <Icon aria-hidden="true" className="size-5" />
    </span>
  )
}

/**
 * What the collapsed row warns about, in warning ink: the languages missing at
 * phone width (from `sm` up the list of languages spells every one out, so this
 * chip is hidden there), and that guests cannot see the tile.
 */
function TileMarkers({
  phoneChip,
  hiddenNote,
}: Readonly<{ phoneChip: string | null; hiddenNote: string | null }>) {
  if (phoneChip === null && hiddenNote === null) return null
  return (
    <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-medium text-warn">
      {phoneChip === null ? null : (
        <span className="inline-flex items-center gap-1 sm:hidden">
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {phoneChip}
        </span>
      )}
      {hiddenNote === null ? null : (
        <span className="inline-flex items-start gap-1">
          <EyeOff aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {hiddenNote}
        </span>
      )}
    </span>
  )
}

function LanguageChips({
  chips,
}: Readonly<{ chips: ReturnType<typeof linkLocaleChips> }>) {
  return (
    <ul aria-label="Languages" className="hidden shrink-0 gap-1.5 sm:flex">
      {chips.map((chip) => (
        <li
          key={chip.locale}
          className={`inline-flex items-center gap-0.5 text-xs ${chip.isMissing ? 'font-medium text-warn' : 'text-muted-foreground'}`}
        >
          {chip.isMissing ? (
            <CircleAlert aria-hidden="true" className="size-3 shrink-0" />
          ) : null}
          {chip.chip}
          {chip.isMissing ? <span className="sr-only"> missing</span> : null}
        </li>
      ))}
    </ul>
  )
}

type MenuProps = Readonly<{
  name: string
  isOpen: boolean
  canDelete: boolean
  onToggle: () => void
  onDelete: () => void
}>

function LinktreeActionsMenu({ name, isOpen, canDelete, onToggle, onDelete }: MenuProps) {
  return (
    <RowActionsMenu name={name}>
      <RowActionsItem onSelect={onToggle}>
        {isOpen ? 'Close editor' : 'Edit'}
      </RowActionsItem>
      {canDelete ? (
        <RowActionsItem destructive opensDialog onSelect={onDelete}>
          Delete link
        </RowActionsItem>
      ) : null}
    </RowActionsMenu>
  )
}
