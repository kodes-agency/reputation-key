// The Share tab's addresses and what is done with them: the QR one (it carries
// the access-artifact marker) draws the image, the direct one is shown and
// copied, the NFC one is copied. "Download again" fetches the address once per
// call, which the server records, and then works from memory like a made one.

import { directPortalAddress } from './portal-share-state'
import type { PortalShareProps } from './portal-share-types'
import { useAddressReveal } from './use-address-reveal'
import { useCopyLink } from './use-copy-link'

export function usePortalShareAddresses(props: PortalShareProps) {
  const publicUrl = props.issuedLink?.publicUrl ?? null
  const directUrl = publicUrl === null ? null : directPortalAddress(publicUrl)
  const nfcPublicUrl = props.issuedLink?.publicUrls?.nfc ?? null
  const direct = useCopyLink(directUrl)
  const nfc = useCopyLink(nfcPublicUrl)
  const reveal = useAddressReveal(props)
  return {
    publicUrl,
    directUrl,
    nfcPublicUrl,
    direct,
    nfc,
    showAddress: async () => (await reveal('show')) !== null,
    resolveQrAddress: async () => (await reveal('download'))?.publicUrl ?? null,
    copyNfcAddress: () =>
      nfcPublicUrl !== null
        ? nfc.copyLink()
        : nfc.copyFetchedLink(
            async () => (await reveal('copy'))?.publicUrls?.nfc ?? null,
          ),
  }
}
