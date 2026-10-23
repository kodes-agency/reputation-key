import type { PortalAccessArtifactChannel } from '../../domain/portal-access-artifact'

/** The columns a long address is stored by: what a code row keeps. */
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

/**
 * What a presented address is looked up by (ADR 0069): a long address by its three
 * hash columns, a print code by its keyed hash. `kind` is the only way to tell
 * them apart, so every consumer narrows on it.
 */
export type PresentedAddressDigest =
  | (PortalTokenDigest & Readonly<{ kind: 'long' }>)
  | (PrintCodeDigest & Readonly<{ kind: 'short' }>)

/** A print code and the keyed hash that is stored for it. Both are credentials. */
export type DerivedPrintCode = Readonly<{ printCode: string; printCodeHash: string }>

/** One print code per access artifact channel of a code row. */
export type DerivedPrintCodes = Readonly<
  Record<PortalAccessArtifactChannel, DerivedPrintCode>
>

export type PortalTokenCodec = Readonly<{
  issue: () => IssuedPortalToken
  /**
   * What a presented address resolves by, or null when it is neither shape. A
   * print code is read in whatever case or look-alikes a reader sent; the long
   * shape contains `_`, so the two never overlap.
   */
  digest: (raw: string) => PresentedAddressDigest | null
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
