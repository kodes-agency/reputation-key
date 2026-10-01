// "Replace photo" (round-4 admin board 14): choose the Property's photograph, put
// the focal point on what every page must keep in view, see how a phone draws it,
// describe it for people who cannot see it, confirm it may be used, and press
// "Use photo". With a photograph already in place and no new file chosen the same
// dialog moves its focal point and edits its descriptions ("Save").
//
// Controlled (the section's button opens it); its body is mounted only while it
// is open, so a closed dialog holds no file and no half-typed description. It
// cannot be closed while a photo is on its way: Escape, the overlay and the close
// button would otherwise put the photograph on the look after the person had
// walked away from it.

import { useState, type ReactNode } from 'react'
import { EyeOff, ImageIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { ImageChecksList } from '../portal-media/image-checks-list'
import { describeImageFacts } from '../portal-media/image-checks'
import { ImageFileButton } from '../portal-media/image-file-button'
import { ImageRightsField } from '../portal-media/image-rights-field'
import { FocalPointPicker } from './focal-point-picker'
import {
  descriptionFields,
  photoDialogTitle,
  photoButtonLabel,
} from './property-photo-rules'
import { usePhotoDialog, type PhotoDialogInput } from './use-photo-dialog'
import type { PreviewMedia } from './property-look-preview-brand'

type Props = Readonly<
  Omit<PhotoDialogInput, 'onBusyChange' | 'onClose'> & {
    open: boolean
    onOpenChange: (open: boolean) => void
    propertyName: string
    /** The phone beside the photograph, drawn with the photograph as it is now. */
    renderPhone: (hero: NonNullable<PreviewMedia['hero']> | null) => ReactNode
  }
>

export function PropertyLookPhotoDialog({
  open,
  onOpenChange,
  propertyName,
  renderPhone,
  ...input
}: Props) {
  const [isBusy, setIsBusy] = useState(false)
  const close = () => {
    setIsBusy(false)
    onOpenChange(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else if (!isBusy) close()
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl lg:max-w-4xl">
        <PhotoDialogBody
          {...input}
          propertyName={propertyName}
          renderPhone={renderPhone}
          onBusyChange={setIsBusy}
          onClose={close}
        />
      </DialogContent>
    </Dialog>
  )
}

type BodyProps = Readonly<
  PhotoDialogInput & {
    propertyName: string
    renderPhone: Props['renderPhone']
  }
>

function PhotoDialogBody({ propertyName, renderPhone, ...input }: BodyProps) {
  const dialog = usePhotoDialog(input)
  const { picker, photo, focal } = dialog
  const hasPhoto = input.hero !== null
  const fields = descriptionFields(input.locales, dialog.descriptions)
  return (
    <>
      <DialogHeader>
        <DialogTitle>{photoDialogTitle(hasPhoto)}</DialogTitle>
        <DialogDescription>
          Shown at the top of every portal at {propertyName}.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-4">
          {photo ? (
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">
                Drag the circle to what guests should always see.
              </p>
              <FocalPointPicker
                src={photo.url}
                width={photo.width}
                height={photo.height}
                focal={focal}
                onChange={dialog.setFocal}
                disabled={dialog.isBusy}
                maxHeightRem={20}
              />
            </div>
          ) : (
            <div className="grid min-h-40 place-items-center rounded-md border border-dashed p-6 text-center">
              <ImageIcon className="size-8 text-muted-foreground" aria-hidden />
            </div>
          )}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium">
                {picker.chosen
                  ? picker.chosen.file.name
                  : hasPhoto
                    ? 'Current photo'
                    : 'No photo yet'}
              </p>
              {picker.chosen ? (
                <p className="text-muted-foreground">
                  {describeImageFacts(picker.chosen.facts)}
                </p>
              ) : null}
            </div>
            <ImageFileButton
              inputLabel="Photo file"
              variant="outline"
              disabled={dialog.isBusy || picker.isReading}
              onFile={(file) => void dialog.choose(file)}
            >
              {picker.chosen || hasPhoto ? 'Choose another photo' : 'Choose a photo'}
            </ImageFileButton>
          </div>
          {picker.chosen ? <ImageChecksList checks={picker.checks} /> : null}
          {picker.chosen || hasPhoto ? null : (
            <p className="text-sm text-muted-foreground">
              JPEG, PNG or WebP, up to 10 MB. It is re-saved on upload, and any location
              data in it is removed.
            </p>
          )}
        </div>
        <div className="hidden justify-center md:flex">
          {renderPhone(
            photo
              ? {
                  url: photo.url,
                  width: photo.width,
                  height: photo.height,
                  focalX: focal.x,
                  focalY: focal.y,
                }
              : null,
          )}
        </div>
      </div>
      {photo ? (
        <div className="space-y-3">
          {fields.map((field) => (
            <div key={field.locale} className="space-y-1.5">
              <label
                htmlFor={`photo-description-${field.locale}`}
                className="text-sm font-medium"
              >
                {field.label}
              </label>
              <Input
                id={`photo-description-${field.locale}`}
                value={field.value}
                autoComplete="off"
                disabled={dialog.isBusy}
                aria-invalid={dialog.problem !== null}
                aria-describedby="photo-description-hint"
                onChange={(event) =>
                  dialog.setDescriptions({
                    ...dialog.descriptions,
                    [field.locale]: event.target.value,
                  })
                }
              />
            </div>
          ))}
          <p
            id="photo-description-hint"
            className={
              dialog.problem ? 'text-sm text-negative' : 'text-sm text-muted-foreground'
            }
          >
            {dialog.problem ?? 'Read aloud to guests who use screen readers.'}
          </p>
        </div>
      ) : null}
      {picker.chosen ? (
        <ImageRightsField
          id="property-photo-rights"
          noun="photo"
          propertyName={propertyName}
          checked={dialog.isConfirmed}
          disabled={dialog.isBusy}
          onCheckedChange={dialog.setIsConfirmed}
        />
      ) : null}
      <p role="alert" className="min-h-5 text-sm text-negative">
        {dialog.message}
      </p>
      <DialogFooter className="sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <EyeOff className="size-4 shrink-0" aria-hidden />
          Live pages change when you publish the property look.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            type="button"
            variant="ghost"
            disabled={dialog.isBusy}
            onClick={input.onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!dialog.canSubmit}
            onClick={() => void dialog.submit()}
          >
            {photoButtonLabel(picker.chosen !== null, dialog.isBusy)}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
