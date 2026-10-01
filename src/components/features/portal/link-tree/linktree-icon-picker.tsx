// What a tile wears: one choice from the closed icon catalogue, or the photo
// uploaded for it. A radio group, so the arrow keys move between the choices and
// Tab enters and leaves it once. The dashed tile at the end is not a choice but
// the way to upload one: it opens the photo dialog (linktree-photo-dialog.tsx).

import { ImagePlus } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { LINK_ICONS, LINK_ICON_CHOICES, linkIconLabel } from './link-icons'
import { uploadTileLabel } from './linktree-photo-rules'
import {
  parsePortalLinkIconKey,
  type PortalLinkIconKey,
} from '#/shared/domain/portal-link-icon'

type Props = Readonly<{
  /** The tile's icon key; ignored while the tile has a photo. */
  value: string | null
  /** The address of the tile's photo, if it has one. */
  photoUrl: string | null
  onChange: (key: PortalLinkIconKey) => void
  /** Opens the dialog that uploads a photo for this tile. */
  onUploadPhoto: () => void
  disabled?: boolean
}>

const PHOTO_VALUE = 'photo'
const PHOTO_SIZE = 40

const BOX_CLASS =
  'grid size-10 place-items-center rounded-md border outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'
const CHOICE_CLASS = `${BOX_CLASS} border-input text-muted-foreground hover:bg-accent hover:text-foreground data-[state=checked]:border-primary data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary data-[state=checked]:ring-1 data-[state=checked]:ring-primary`
const UPLOAD_CLASS = `${BOX_CLASS} border-dashed border-muted-foreground/60 text-muted-foreground hover:bg-accent hover:text-foreground`

export function LinktreeIconPicker({
  value,
  photoUrl,
  onChange,
  onUploadPhoto,
  disabled,
}: Props) {
  return (
    <RadioGroupPrimitive.Root
      aria-label="Icon or photo"
      value={photoUrl === null ? (parsePortalLinkIconKey(value) ?? '') : PHOTO_VALUE}
      disabled={disabled}
      onValueChange={(key) => {
        const chosen = parsePortalLinkIconKey(key)
        if (chosen !== null) onChange(chosen)
      }}
      className="flex flex-wrap gap-2"
    >
      {photoUrl === null ? null : (
        <RadioGroupPrimitive.Item
          value={PHOTO_VALUE}
          aria-label="Your photo"
          className={`${CHOICE_CLASS} overflow-hidden p-0`}
        >
          <img
            src={photoUrl}
            alt=""
            width={PHOTO_SIZE}
            height={PHOTO_SIZE}
            className="size-full object-cover"
          />
        </RadioGroupPrimitive.Item>
      )}
      {LINK_ICON_CHOICES.map((key) => {
        const Icon = LINK_ICONS[key]
        return (
          <RadioGroupPrimitive.Item
            key={key}
            value={key}
            aria-label={linkIconLabel(key)}
            className={CHOICE_CLASS}
          >
            <Icon aria-hidden="true" className="size-5" />
          </RadioGroupPrimitive.Item>
        )
      })}
      <button
        type="button"
        aria-label={uploadTileLabel(photoUrl !== null)}
        title={uploadTileLabel(photoUrl !== null)}
        disabled={disabled}
        onClick={onUploadPhoto}
        className={UPLOAD_CLASS}
      >
        <ImagePlus aria-hidden="true" className="size-5" />
      </button>
    </RadioGroupPrimitive.Root>
  )
}
