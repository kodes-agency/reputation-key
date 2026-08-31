import type { Action } from '#/components/hooks/use-action'
import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'

export type IssuedPortalLink = Readonly<{
  publicUrl: string
  publicUrls?: Readonly<{ qr: string; nfc: string }>
}>

export type RotatePortalLinkInput = Readonly<{
  portalId: string
  replacementKind?: 'planned' | 'security'
  gracePeriodDays?: number
}>

export type PortalShareMutations = Readonly<{
  issueMutation: Action<{ data: { portalId: string } }, IssuedPortalLink>
  rotateMutation: Action<{ data: RotatePortalLinkInput }, IssuedPortalLink>
  revokeMutation: Action<{ data: { portalId: string; reason: string } }, unknown>
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
  onLinksRevoked: () => void
}> &
  PortalShareMutations
