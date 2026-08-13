import type { Action } from '#/components/hooks/use-action'

export type IssuedPortalLink = Readonly<{ publicUrl: string }>

export type PortalShareMutations = Readonly<{
  issueMutation: Action<
    { data: { portalId: string; printBatch?: string } },
    IssuedPortalLink
  >
  rotateMutation: Action<{ data: { portalId: string } }, IssuedPortalLink>
  revokeMutation: Action<{ data: { portalId: string; reason: string } }, unknown>
}>

export type PortalShareProps = Readonly<{
  portalId: string
  portalName: string
  issuedLink: IssuedPortalLink | null
  revoked: boolean
  onLinkIssued: (link: IssuedPortalLink) => void
  onLinksRevoked: () => void
}> &
  PortalShareMutations
