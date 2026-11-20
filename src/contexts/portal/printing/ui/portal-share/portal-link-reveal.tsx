// The public address. With an address in memory (just made, replaced or fetched
// again) it is shown and can be copied. When the live code was sealed, the row
// is there after a reload too, with a button that fetches the address again;
// otherwise it renders nothing once the address is gone, and the code block says
// what is left. The "save it now" warning belongs only to an address that
// cannot be fetched again (ADR 0064).

import { useEffect, useState } from 'react'
import { Copy, Eye } from 'lucide-react'
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
  showSaveWarning: boolean
  /**
   * Fetching the address again, when it is not in memory; resolves to whether it
   * arrived. Null when it cannot be fetched.
   */
  onShowAddress: (() => Promise<boolean>) | null
  disabled: boolean
}>

export function PortalLinkReveal({
  publicUrl,
  linkRef,
  copied,
  copyFailed,
  onCopy,
  showSaveWarning,
  onShowAddress,
  disabled,
}: Props) {
  // Set once a fetch succeeded: the address then takes the pressed button's
  // place, and focus follows it.
  const [fetchedHere, setFetchedHere] = useState(false)
  if (publicUrl === null && onShowAddress === null) return null
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
      {showSaveWarning && <SaveAddressWarning />}
      {publicUrl === null ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={disabled}
          onClick={() => void onShowAddress?.().then(setFetchedHere)}
        >
          <Eye /> Show address
        </Button>
      ) : (
        <AddressRow
          publicUrl={publicUrl}
          focusOnShow={fetchedHere}
          linkRef={linkRef}
          copied={copied}
          onCopy={onCopy}
        />
      )}
      {copyFailed && (
        <p className="text-sm text-negative" role="alert">
          {COPY_FAILED_MESSAGE}
        </p>
      )}
    </section>
  )
}

function AddressRow({
  publicUrl,
  focusOnShow,
  linkRef,
  copied,
  onCopy,
}: Readonly<{
  publicUrl: string
  /** Move focus to the address, which a screen reader then reads out. */
  focusOnShow: boolean
  linkRef: RefObject<HTMLElement | null>
  copied: boolean
  onCopy: () => Promise<void>
}>) {
  useEffect(() => {
    if (focusOnShow) linkRef.current?.focus()
  }, [focusOnShow, linkRef])
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <code
        ref={linkRef}
        tabIndex={-1}
        className="min-w-0 flex-1 break-all rounded-md border bg-muted px-3 py-2 text-sm"
      >
        {publicUrl}
      </code>
      <Button type="button" variant="outline" onClick={() => void onCopy()}>
        <Copy /> {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

function SaveAddressWarning() {
  return (
    <Alert variant="warning">
      <AlertTitle>Save this address now</AlertTitle>
      <AlertDescription>
        For security, the full address and the QR image are not shown again after this
        page is reloaded. Copy the address, download the code and copy the NFC address
        before you leave.
      </AlertDescription>
    </Alert>
  )
}
