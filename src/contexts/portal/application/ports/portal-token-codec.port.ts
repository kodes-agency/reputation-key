export type PortalTokenDigest = Readonly<{
  tokenIdentifier: string
  tokenHash: string
  tokenKeyVersion: number
}>

export type IssuedPortalToken = PortalTokenDigest &
  Readonly<{
    rawToken: string
  }>

export type PortalTokenCodec = Readonly<{
  issue: () => IssuedPortalToken
  digest: (rawToken: string) => PortalTokenDigest | null
}>
