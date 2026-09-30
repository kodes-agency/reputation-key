// The public address, in the one render in which it exists: show it, and let it
// be copied. Renders nothing once the address is gone (a reload, or a stop) —
// the code block says what is left then.
//
// Stays until the encrypted address lands (slice 33): until then this is the
// only place a newly made code's address appears, so it must not be removed.

import { Copy, Link2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { COPY_FAILED_MESSAGE } from './use-copy-link'
import type { RefObject } from 'react'

type Props = Readonly<{
  publicUrl: string | null
  linkRef: RefObject<HTMLElement | null>
  copied: boolean
  copyFailed: boolean
  onCopy: () => Promise<void>
}>

export function PortalLinkReveal({
  publicUrl,
  linkRef,
  copied,
  copyFailed,
  onCopy,
}: Props) {
  if (publicUrl === null) return null
  return (
    <section className="flex flex-col gap-3" aria-labelledby="public-address-heading">
      <div className="flex flex-col gap-1">
        <h2 id="public-address-heading" className="text-lg font-semibold">
          Public address
        </h2>
        <p className="text-sm text-muted-foreground">
          Opens the portal. Use it on your website, in emails and in booking messages.
        </p>
      </div>
      <SaveAddressWarning />
      <div className="flex flex-col gap-2 sm:flex-row">
        <code
          ref={linkRef}
          className="min-w-0 flex-1 break-all rounded-md border bg-muted px-3 py-2 text-sm"
        >
          {publicUrl}
        </code>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 sm:min-h-9"
          onClick={() => void onCopy()}
        >
          <Copy data-icon="inline-start" /> {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {copyFailed && (
        <p className="text-sm text-destructive" role="alert">
          {COPY_FAILED_MESSAGE}
        </p>
      )}
    </section>
  )
}

function SaveAddressWarning() {
  return (
    <Alert>
      <Link2 />
      <AlertTitle>Save this address now</AlertTitle>
      <AlertDescription>
        For security, the full address and the QR image are not shown again after this
        page is reloaded. Copy the address, download the code and copy the NFC address
        before you leave.
      </AlertDescription>
    </Alert>
  )
}
