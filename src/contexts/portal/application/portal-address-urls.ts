// Portal context — the public URLs of one code.
//
// A code is one address with two markers: the QR image carries the address and
// its QR marker, the NFC tag carries the same address and the NFC marker. A
// visit that carries a marker is recorded as a scan from that channel. Issue,
// replace and "download again" all build the pair here, so the three can never
// disagree about what a code's URLs are.

export type PortalPublicUrls = Readonly<{ qr: string; nfc: string }>

export function buildPortalPublicUrls(
  baseUrl: string,
  rawToken: string,
  accessArtifactIds: Readonly<{ qr: string; nfc: string }>,
): PortalPublicUrls {
  const urlFor = (accessArtifactId: string): string => {
    const url = new URL(`/p/${rawToken}`, baseUrl)
    url.searchParams.set('accessArtifact', accessArtifactId)
    return url.toString()
  }
  return { qr: urlFor(accessArtifactIds.qr), nfc: urlFor(accessArtifactIds.nfc) }
}
