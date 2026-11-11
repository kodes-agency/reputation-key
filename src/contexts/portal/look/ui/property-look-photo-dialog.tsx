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

import type { ReactNode } from 'react'
import { ImageIcon } from 'lucide-react'
import { DialogDescription, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { ImageChecksList } from '#/components/features/portal/portal-media/image-checks-list'
import { describeImageFacts } from '#/components/features/portal/portal-media/image-checks'
import { ImageFileButton } from '#/components/features/portal/portal-media/image-file-button'
import { ImageRightsField } from '#/components/features/portal/portal-media/image-rights-field'
import { UploadDialogFooter } from '#/components/features/portal/portal-media/upload-dialog-footer'
import { UploadDialogShell } from '#/components/features/portal/portal-media/upload-dialog-shell'
import { FocalPointPicker } from './focal-point-picker'
import {
  descriptionFields,
  photoDialogTitle,
  photoButtonLabel,
} from './property-photo-rules'
import { usePhotoDialog, type PhotoDialogInput } from './use-photo-dialog'
import type { PreviewMedia } from './property-look-preview-brand'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { PhotoTakedown } from './photo-takedown'

type Props = Readonly<
  Omit<PhotoDialogInput, 'onBusyChange' | 'onClose'> & {
    open: boolean
    onOpenChange: (open: boolean) => void
    propertyName: string
    /**
     * The phone beside the photograph, drawn with the photograph as it is now;
     * left out, the photograph has the dialog to itself (a portal's editor has
     * its own phone beside it).
     */
    renderPhone?: (hero: NonNullable<PreviewMedia['hero']> | null) => ReactNode
    /** Who sees the photograph; the Property's pages unless the caller says otherwise. */
    description?: string
    /** The foot's line on when live pages change; the Property look's unless said. */
    footerNote?: string
  }
>

export function PropertyLookPhotoDialog({
  open,
  onOpenChange,
  propertyName,
  renderPhone,
  description,
  footerNote,
  ...input
}: Props) {
  return (
    <UploadDialogShell open={open} onOpenChange={onOpenChange} size="xl">
      {(guard) => (
        <PhotoDialogBody
          {...input}
          {...guard}
          propertyName={propertyName}
          renderPhone={renderPhone}
          description={description}
          footerNote={footerNote}
        />
      )}
    </UploadDialogShell>
  )
}

type BodyProps = Readonly<
  PhotoDialogInput & {
    propertyName: string
    renderPhone: Props['renderPhone']
    description: Props['description']
    footerNote: Props['footerNote']
  }
>

function PhotoDialogBody({
  propertyName,
  renderPhone,
  description,
  footerNote,
  ...input
}: BodyProps) {
  const dialog = usePhotoDialog(input)
  const { picker, photo } = dialog
  const hasPhoto = input.hero !== null
  const takenDownAsset = input.hero?.assetId
  const { onTakeDown } = input
  const fields = descriptionFields(input.locales, dialog.descriptions)
  return (
    <>
      <DialogHeader>
        <DialogTitle>{photoDialogTitle(hasPhoto)}</DialogTitle>
        <DialogDescription>
          {description ?? `Shown at the top of every portal at ${propertyName}.`}
        </DialogDescription>
      </DialogHeader>
      <div className={renderPhone ? 'grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]' : ''}>
        <div className="min-w-0 space-y-4">
          <PhotoFocalArea dialog={dialog} />
          <PhotoFileRow dialog={dialog} hasPhoto={hasPhoto} />
          {picker.chosen ? <ImageChecksList checks={picker.checks} /> : null}
          {onTakeDown && takenDownAsset && !picker.chosen ? (
            <PhotoTakedown
              disabled={dialog.isBusy}
              onTakeDown={() => onTakeDown(takenDownAsset)}
              onBusyChange={input.onBusyChange}
              onDone={input.onClose}
            />
          ) : null}
          {picker.chosen || hasPhoto ? null : (
            <p className="text-sm text-muted-foreground">
              JPEG, PNG or WebP, up to 10 MB. It is re-saved on upload, and any location
              data in it is removed.
            </p>
          )}
        </div>
        {renderPhone ? <PhonePane dialog={dialog} renderPhone={renderPhone} /> : null}
      </div>
      {photo ? (
        <PhotoDescriptionFields
          fields={fields}
          overlong={dialog.overlong}
          problem={dialog.problem}
          disabled={dialog.isBusy}
          onChange={(locale, value) =>
            dialog.setDescriptions({ ...dialog.descriptions, [locale]: value })
          }
        />
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
      <FormErrorBanner error={dialog.message} />
      <UploadDialogFooter
        primaryLabel={photoButtonLabel(picker.chosen !== null, false)}
        pendingLabel={photoButtonLabel(picker.chosen !== null, true)}
        {...(footerNote === undefined ? {} : { note: footerNote })}
        canSubmit={dialog.canSubmit}
        isBusy={dialog.isBusy}
        onSubmit={() => void dialog.submit()}
      />
    </>
  )
}

type DescriptionField = ReturnType<typeof descriptionFields>[number]

function PhotoDescriptionFields({
  fields,
  overlong,
  problem,
  disabled,
  onChange,
}: Readonly<{
  fields: ReadonlyArray<DescriptionField>
  overlong: ReadonlyArray<string>
  problem: string | null
  disabled: boolean
  onChange: (locale: DescriptionField['locale'], value: string) => void
}>) {
  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const isOver = overlong.includes(field.locale)
        const errorId = `photo-description-error-${field.locale}`
        return (
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
              disabled={disabled}
              aria-invalid={isOver}
              aria-describedby={
                isOver ? `${errorId} photo-description-hint` : 'photo-description-hint'
              }
              onChange={(event) => onChange(field.locale, event.target.value)}
            />
            {isOver && problem ? (
              <p id={errorId} className="text-sm text-negative">
                {problem}
              </p>
            ) : null}
          </div>
        )
      })}
      <p id="photo-description-hint" className="text-sm text-muted-foreground">
        Read aloud to guests who use screen readers.
      </p>
    </div>
  )
}

type Dialog = ReturnType<typeof usePhotoDialog>

function PhotoFocalArea({ dialog }: Readonly<{ dialog: Dialog }>) {
  const { photo, focal } = dialog
  if (!photo) {
    return (
      <div className="grid min-h-40 place-items-center rounded-md border border-dashed p-6 text-center">
        <ImageIcon className="size-8 text-muted-foreground" aria-hidden />
      </div>
    )
  }
  return (
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
  )
}

function photoFileName(chosenName: string | null, hasPhoto: boolean): string {
  if (chosenName) return chosenName
  return hasPhoto ? 'Current photo' : 'No photo yet'
}

function PhotoFileRow({
  dialog,
  hasPhoto,
}: Readonly<{ dialog: Dialog; hasPhoto: boolean }>) {
  const { picker } = dialog
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 text-sm">
        <p className="truncate font-medium">
          {photoFileName(picker.chosen?.file.name ?? null, hasPhoto)}
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
  )
}

function PhonePane({
  dialog,
  renderPhone,
}: Readonly<{ dialog: Dialog; renderPhone: NonNullable<Props['renderPhone']> }>) {
  const { photo, focal } = dialog
  return (
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
  )
}
