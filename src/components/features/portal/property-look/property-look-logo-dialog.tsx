// The logo (round-4 admin board 09, "Name and logo"): choose a light logo on a
// transparent background, see it on a dark page's colour, confirm it may be used
// and press "Use logo". It replaces the wordmark on guest pages once the look is
// published (the printed kit does not draw it yet: slice 45).
//
// Controlled, with its body mounted only while open (no file, no half-made
// choice stays behind), and it cannot be closed while a logo is on its way.

import { DialogDescription, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { describeImageFacts } from '../portal-media/image-checks'
import { ImageChecksList } from '../portal-media/image-checks-list'
import { ImageFileButton } from '../portal-media/image-file-button'
import { ImageRightsField } from '../portal-media/image-rights-field'
import { UploadDialogFooter } from '../portal-media/upload-dialog-footer'
import { UploadDialogShell } from '../portal-media/upload-dialog-shell'
import { useLogoDialog, type LogoDialogInput } from './use-logo-dialog'
import { FormErrorBanner } from '#/components/forms/form-error-banner'

type Props = Readonly<
  Omit<LogoDialogInput, 'onBusyChange' | 'onClose'> & {
    open: boolean
    onOpenChange: (open: boolean) => void
    propertyName: string
    hasLogo: boolean
  }
>

export function PropertyLookLogoDialog({
  open,
  onOpenChange,
  propertyName,
  hasLogo,
  ...input
}: Props) {
  return (
    <UploadDialogShell open={open} onOpenChange={onOpenChange} className="sm:max-w-md">
      {(guard) => (
        <LogoDialogBody
          {...input}
          {...guard}
          propertyName={propertyName}
          hasLogo={hasLogo}
        />
      )}
    </UploadDialogShell>
  )
}

function LogoDialogBody({
  propertyName,
  hasLogo,
  ...input
}: LogoDialogInput & Readonly<{ propertyName: string; hasLogo: boolean }>) {
  const dialog = useLogoDialog(input)
  const { picker } = dialog
  return (
    <>
      <DialogHeader>
        <DialogTitle>{hasLogo ? 'Replace logo' : 'Upload logo'}</DialogTitle>
        <DialogDescription>
          Replaces the wordmark at the top of every guest page.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {/* The guest page draws the logo on a dark header, so the preview is a dark-theme scope in either app theme. */}
        <div className="dark grid min-h-16 place-items-center rounded-md bg-card p-4">
          {picker.chosen ? (
            <img
              src={picker.chosen.previewUrl}
              alt="The chosen logo, on a dark background"
              width={picker.chosen.facts.width}
              height={picker.chosen.facts.height}
              className="w-auto max-w-full object-contain"
              style={{ maxHeight: 80 }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Your logo, on a dark page</p>
          )}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 text-sm">
            {picker.chosen ? (
              <>
                <p className="truncate font-medium">{picker.chosen.file.name}</p>
                <p className="text-muted-foreground">
                  {describeImageFacts(picker.chosen.facts)}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                A light logo, best as a PNG or WebP with a transparent background (a JPEG
                keeps its own background). Up to 10 MB.
              </p>
            )}
          </div>
          <ImageFileButton
            inputLabel="Logo file"
            disabled={dialog.isBusy || picker.isReading}
            onFile={(file) => void dialog.choose(file)}
          >
            {picker.chosen ? 'Choose another logo' : 'Choose a logo'}
          </ImageFileButton>
        </div>
        {picker.chosen ? <ImageChecksList checks={picker.checks} /> : null}
        {picker.chosen ? (
          <ImageRightsField
            id="property-logo-rights"
            noun="logo"
            propertyName={propertyName}
            checked={dialog.isConfirmed}
            disabled={dialog.isBusy}
            onCheckedChange={dialog.setIsConfirmed}
          />
        ) : null}
      </div>
      <FormErrorBanner error={dialog.message} />
      <UploadDialogFooter
        primaryLabel={dialog.isBusy ? 'Uploading…' : 'Use logo'}
        canSubmit={dialog.canSubmit}
        isBusy={dialog.isBusy}
        onSubmit={() => void dialog.submit()}
        onCancel={input.onClose}
      />
    </>
  )
}
