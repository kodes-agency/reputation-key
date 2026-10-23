import type { PortalAccessArtifactChannel } from '../../domain/portal-access-artifact'

export type PortalTokenDigest = Readonly<{
  tokenIdentifier: string
  tokenHash: string
  tokenKeyVersion: number
}>

export type IssuedPortalToken = PortalTokenDigest &
  Readonly<{
    rawToken: string
  }>

/** What a print code is looked up by. The code itself is never stored (ADR 0069). */
export type PrintCodeDigest = Readonly<{ printCodeHash: string }>

/** A print code and the keyed hash that is stored for it. Both are credentials. */
export type DerivedPrintCode = Readonly<{ printCode: string; printCodeHash: string }>

/** One print code per access artifact channel of a code row. */
export type DerivedPrintCodes = Readonly<
  Record<PortalAccessArtifactChannel, DerivedPrintCode>
>

export type PortalTokenCodec = Readonly<{
  issue: () => IssuedPortalToken
  /** Long addresses only: null for a print code, which has its own digest. */
  digest: (rawToken: string) => PortalTokenDigest | null
  /** The keyed hash of a print code, in whatever case or look-alikes a reader sent. */
  digestPrintCode: (raw: string) => PrintCodeDigest | null
  /** Shape only: no key, no lookup. */
  isPrintCode: (raw: string) => boolean
  /**
   * The two print codes a code row's long address and access artifacts give, or
   * null when the address is not a well-formed long address or an artifact id is
   * not usable. The same inputs always give the same codes.
   */
  derivePrintCodes: (
    input: Readonly<{
      rawToken: string
      accessArtifactIds: Readonly<Record<PortalAccessArtifactChannel, string>>
    }>,
  ) => DerivedPrintCodes | null
}>
