import type { Action } from '#/components/hooks/use-action'
import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'

export type IssuedPortalLink = Readonly<{
  publicUrl: string
  publicUrls?: Readonly<{ qr: string; nfc: string }>
  /** Set by the page when the address was fetched again rather than made. */
  revealed?: boolean
}>

/** Why the address is wanted; recorded with the disclosure and nothing else. */
export type RevealPurpose = 'download' | 'copy'

export type RotatePortalLinkInput = Readonly<{
  portalId: string
  replacementKind?: 'planned' | 'security'
  gracePeriodDays?: number
}>

export type PortalShareMutations = Readonly<{
  issueMutation: Action<{ data: { portalId: string } }, IssuedPortalLink>
  rotateMutation: Action<{ data: RotatePortalLinkInput }, IssuedPortalLink>
  revokeMutation: Action<{ data: { portalId: string; reason: string } }, unknown>
  /** "Download again": the address of the live code, from its sealed copy. */
  revealMutation: Action<
    { data: { portalId: string; purpose: RevealPurpose } },
    IssuedPortalLink
  >
}>

export type PortalShareProps = Readonly<{
  portalId: string
  portalName: string
  issuedLink: IssuedPortalLink | null
  revoked: boolean
  /**
   * Durable answer to "is a public link live?" (C2). The raw URL is returned
   * only by issue/rotate, so the token affordances cannot be derived from
   * `issuedLink` — that is in-session state and is empty after a reload.
   */
  tokenStatus: PortalTokenStatus
  onLinkIssued: (link: IssuedPortalLink) => void
  /** An address fetched again is held like a made one, until the page is left. */
  onAddressRevealed: (link: IssuedPortalLink) => void
  onLinksRevoked: () => void
}> &
  PortalShareMutations
