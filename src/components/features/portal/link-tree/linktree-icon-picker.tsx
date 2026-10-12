// What a tile wears: one choice from the closed icon catalogue, or the photo
// uploaded for it. A radio group, so the arrow keys move between the choices and
// Tab enters and leaves it once. The dashed tile at the end is not a choice but
// the way to upload one: it opens the photo dialog (linktree-photo-dialog.tsx).
// A photo stays on offer after an icon replaces it, so a slip of the arrow keys
// is never the end of it. Every choice shows its name on hover and on focus (the
// icons are glyphs only), and is a tap target on a phone.

import { ImagePlus } from 'lucide-react'
import type { ReactNode } from 'react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip'
import { LINK_ICONS, LINK_ICON_CHOICES, linkIconLabel } from './link-icons'
import { uploadTileLabel } from './linktree-photo-rules'
import {
  parsePortalLinkIconKey,
  type PortalLinkIconKey,
} from '#/shared/domain/portal-link-icon'

type Props = Readonly<{
  /** The tile's icon key; ignored while the tile wears its photo. */
  value: string | null
  /** The address of the photo on offer: the tile's own, or the one an icon replaced. */
  photoUrl: string | null
  /** Whether the tile wears that photo now (as against an icon). */
  isPhotoChosen: boolean
  onChange: (key: PortalLinkIconKey) => void
  /** Puts the photo on offer back on the tile. */
  onChoosePhoto: () => void
  /** Opens the dialog that uploads a photo for this tile. */
  onUploadPhoto: () => void
  disabled?: boolean
}>

const PHOTO_VALUE = 'photo'
const PHOTO_SIZE = 40

/** How long a pointer rests on a choice before its name appears (a keyboard focus is immediate). */
const TOOLTIP_DELAY_MS = 400

const BOX_CLASS =
  'grid size-10 place-items-center rounded-md border outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 max-md:size-(--control-touch) disabled:cursor-not-allowed disabled:opacity-50'
const CHOICE_CLASS = `${BOX_CLASS} border-input text-muted-foreground hover:bg-accent hover:text-foreground data-[state=checked]:border-primary data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary data-[state=checked]:ring-1 data-[state=checked]:ring-primary`
const UPLOAD_CLASS = `${BOX_CLASS} border-dashed border-muted-foreground/60 text-muted-foreground hover:bg-accent hover:text-foreground`

/**
 * A choice with its name shown on hover and focus. The tooltip sits on a wrapper,
 * not on the radio: both would write `data-state`, and the radio's says which
 * choice is checked.
 */
function Named({ name, children }: Readonly<{ name: string; children: ReactNode }>) {
  return (
    <Tooltip delayDuration={TOOLTIP_DELAY_MS}>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  )
}

export function LinktreeIconPicker({
  value,
  photoUrl,
  isPhotoChosen,
  onChange,
  onChoosePhoto,
  onUploadPhoto,
  disabled,
}: Props) {
  return (
    <RadioGroupPrimitive.Root
      aria-label="Icon or photo"
      value={
        photoUrl !== null && isPhotoChosen
          ? PHOTO_VALUE
          : (parsePortalLinkIconKey(value) ?? '')
      }
      disabled={disabled}
      onValueChange={(key) => {
        if (key === PHOTO_VALUE) {
          onChoosePhoto()
          return
        }
        const chosen = parsePortalLinkIconKey(key)
        if (chosen !== null) onChange(chosen)
      }}
      className="flex flex-wrap gap-2"
    >
      {photoUrl === null ? null : (
        <Named name="Your photo">
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
        </Named>
      )}
      {LINK_ICON_CHOICES.map((key) => {
        const Icon = LINK_ICONS[key]
        return (
          <Named key={key} name={linkIconLabel(key)}>
            <RadioGroupPrimitive.Item
              value={key}
              aria-label={linkIconLabel(key)}
              className={CHOICE_CLASS}
            >
              <Icon aria-hidden="true" className="size-5" />
            </RadioGroupPrimitive.Item>
          </Named>
        )
      })}
      <Named name={uploadTileLabel(isPhotoChosen)}>
        <button
          type="button"
          aria-label={uploadTileLabel(isPhotoChosen)}
          disabled={disabled}
          onClick={onUploadPhoto}
          className={UPLOAD_CLASS}
        >
          <ImagePlus aria-hidden="true" className="size-5" />
        </button>
      </Named>
    </RadioGroupPrimitive.Root>
  )
}
