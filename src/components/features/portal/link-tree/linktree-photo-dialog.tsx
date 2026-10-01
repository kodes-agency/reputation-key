// The dialog behind the dashed tile in the icon picker: choose a photo for one
// tile, confirm it may be used, and send it. The server decodes and re-encodes
// it (ADR 0063), so what comes back is an asset id, which the section puts on the
// tile. Controlled, because the picker's button opens it; its body is mounted
// only while it is open, so a closed dialog holds no file and no half-typed state.

import { useRef, useState, type ChangeEvent } from 'react'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Field, FieldLabel } from '#/components/ui/field'
import {
  PORTAL_IMAGE_ACCEPT,
  describePortalImageFile,
  uploadPortalImage,
  validatePortalImageFile,
  type PortalImageUploader,
} from '../portal-media/upload-portal-image'

const SAVE_FAILED =
  'The photo was uploaded, but it could not be put on the tile. Try again.'

type Props = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  propertyId: string
  portalId: string
  /** Puts the uploaded photo on the tile. A refusal is shown in the dialog. */
  onUploaded: (assetId: string) => Promise<unknown>
  /** The upload itself; the real one unless a story hands in a stub. */
  upload?: PortalImageUploader
}>

export function LinktreePhotoDialog({
  open,
  onOpenChange,
  propertyId,
  portalId,
  onUploaded,
  upload,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <PhotoDialogBody
          propertyId={propertyId}
          portalId={portalId}
          onUploaded={onUploaded}
          onClose={() => onOpenChange(false)}
          upload={upload}
        />
      </DialogContent>
    </Dialog>
  )
}

type BodyProps = Readonly<{
  propertyId: string
  portalId: string
  onUploaded: (assetId: string) => Promise<unknown>
  onClose: () => void
  upload: PortalImageUploader | undefined
}>

function PhotoDialogBody({
  propertyId,
  portalId,
  onUploaded,
  onClose,
  upload = (input, file) => uploadPortalImage(input, file),
}: BodyProps) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0]
    // The same file can be chosen again after a refusal.
    event.target.value = ''
    if (!picked) return
    const refusal = validatePortalImageFile(picked)
    setMessage(refusal)
    if (refusal === null) setFile(picked)
  }

  const submit = async () => {
    if (!file || !confirmed || isUploading) return
    setIsUploading(true)
    setMessage(null)
    const result = await upload(
      { propertyId, portalId, purpose: 'link_image', rightsConfirmed: confirmed },
      file,
    )
    if (!result.ok) {
      setMessage(result.message)
      setIsUploading(false)
      return
    }
    try {
      await onUploaded(result.assetId)
      onClose()
    } catch {
      setMessage(SAVE_FAILED)
      setIsUploading(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Photo for this tile</DialogTitle>
        <DialogDescription>
          Guests see it on the tile instead of the icon. It is re-saved on upload, and any
          location data in it is removed.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <input
            ref={input}
            type="file"
            accept={PORTAL_IMAGE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label="Photo file"
            onChange={choose}
          />
          <Button
            type="button"
            variant="outline"
            disabled={isUploading}
            onClick={() => input.current?.click()}
          >
            {file ? 'Choose another photo' : 'Choose a photo'}
          </Button>
          <p className="text-sm text-muted-foreground">
            {file ? describePortalImageFile(file) : 'JPEG, PNG or WebP, up to 10 MB.'}
          </p>
        </div>
        <Field orientation="horizontal">
          <Checkbox
            id="linktree-photo-rights"
            checked={confirmed}
            disabled={isUploading}
            onCheckedChange={(next) => setConfirmed(next === true)}
          />
          <FieldLabel htmlFor="linktree-photo-rights" className="font-normal">
            I own this photo or have permission to use it.
          </FieldLabel>
        </Field>
        <p role="alert" className="min-h-5 text-sm text-destructive">
          {message}
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={isUploading} onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!file || !confirmed || isUploading}
          onClick={() => void submit()}
        >
          {isUploading ? 'Uploading…' : 'Use photo'}
        </Button>
      </DialogFooter>
    </>
  )
}
