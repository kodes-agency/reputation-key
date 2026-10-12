import type { Action } from '#/components/hooks/use-action'
import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import type { PortalPublicationState } from '../shared/types'
import type { PortalPrintKitResources } from './portal-print-kit-types'

export type IssuedPortalLink = Readonly<{
  publicUrl: string
  publicUrls?: Readonly<{ qr: string; nfc: string }>
  /** Set by the page when the address was fetched again rather than made. */
  revealed?: boolean
  /**
   * Set by issue and replace: whether the address they made was sealed. It runs
   * ahead of `tokenStatus`, which is stale until the detail refetch lands.
   */
  addressRecoverable?: boolean
  /**
   * Set by issue and replace: the version of the code they made. `tokenStatus`
   * describes that code once its own `version` reaches this one.
   */
  version?: number
}>

/** Why the address is wanted; recorded with the disclosure and nothing else. */
export type RevealPurpose = 'download' | 'copy' | 'show'

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
  /** The Print kit section's read and download. Absent: the tab offers no print kit. */
  printKit?: PortalPrintKitResources
  /**
   * Whether guests can open the page the code leads to. A draft, turned-off or
   * archived portal gets a notice that a scan shows the unavailable page.
   * Absent: the tab says nothing about it.
   */
  publicationState?: PortalPublicationState
  /** The portal's property, for the notice's "Review & publish" link. Absent: no link. */
  propertyId?: string
  /** The property's IANA zone, for when the code before this one stops. Absent: UTC. */
  timeZone?: string
  /**
   * The portal's managers by name, whom someone who can only look asks for the
   * QR code or print kit. Absent or empty: "a manager of this portal".
   */
  managerNames?: readonly string[]
}> &
  PortalShareMutations
