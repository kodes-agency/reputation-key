// The Share tab's addresses and what is done with them: the QR one draws the
// image, the direct one is shown and copied, the NFC one is copied. The QR and
// NFC addresses count a visit as a scan (the short print address by its code, the
// long one by its marker); the direct one never does, so it comes from the server
// as its own field and is never worked out from the QR one. "Download again"
// fetches the addresses once per call, which the server records, and then works
// from memory like made ones.

import { directAddressOf } from './portal-share-state'
import type { PortalShareProps } from './portal-share-types'
import { useAddressReveal } from './use-address-reveal'
import { useCopyLink } from './use-copy-link'

export function usePortalShareAddresses(props: PortalShareProps) {
  const publicUrl = props.issuedLink?.publicUrl ?? null
  const directUrl = directAddressOf(props.issuedLink)
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
