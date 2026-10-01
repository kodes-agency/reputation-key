// The logo (round-4 admin board 09, "Name and logo"): choose a light logo on a
// transparent background, see it on a dark page's colour, confirm it may be used
// and press "Use logo". It replaces the wordmark on guest pages and printed
// codes once the look is published.
//
// Controlled, with its body mounted only while open (no file, no half-made
// choice stays behind), and it cannot be closed while a logo is on its way.

import { useState } from 'react'
import { EyeOff } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { describeImageFacts } from '../portal-media/image-checks'
import { ImageChecksList } from '../portal-media/image-checks-list'
import { ImageFileButton } from '../portal-media/image-file-button'
import { ImageRightsField } from '../portal-media/image-rights-field'
import { useLogoDialog, type LogoDialogInput } from './use-logo-dialog'

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
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <LogoDialogBody
          {...input}
          propertyName={propertyName}
          hasLogo={hasLogo}
          onBusyChange={setIsBusy}
          onClose={close}
        />
      </DialogContent>
    </Dialog>
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
          Replaces the wordmark at the top of every page and on printed codes.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid min-h-24 place-items-center rounded-md bg-neutral-900 p-4">
          {picker.chosen ? (
            <img
              src={picker.chosen.previewUrl}
              alt="The chosen logo, on a dark background"
              width={picker.chosen.facts.width}
              height={picker.chosen.facts.height}
              className="max-h-20 w-auto max-w-full object-contain"
            />
          ) : (
            <p className="text-sm text-neutral-400">Your logo, on a dark page</p>
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
                A light logo on a transparent background, as PNG or WebP. Up to 10 MB.
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
        <p role="alert" className="min-h-5 text-sm text-negative">
          {dialog.message}
        </p>
      </div>
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
            {dialog.isBusy ? 'Uploading…' : 'Use logo'}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
