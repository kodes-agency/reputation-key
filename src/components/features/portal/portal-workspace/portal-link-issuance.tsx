// The once-shown public link, held above the workspace's pages.
//
// A newly issued address is displayed exactly once (ADR 0044), and its only
// copy is this state. The workspace is now several routes — the editor and the
// review page — and moving between them unmounts the editor, so the state
// lives in the layout route instead: a manager who issues a link on the Share
// tab and then opens Review & publish still has it when they come back.
// With a keyring (ADR 0064) the address can also be fetched again, and that
// copy is held here in the same way.

import { createContext, useContext, useState, type ReactNode } from 'react'
import type { IssuedPortalLink } from '../portal-share/portal-share-types'

export type PortalLinkIssuance = Readonly<{
  issuedLink: IssuedPortalLink | null
  linksRevoked: boolean
  onLinkIssued: (link: IssuedPortalLink) => void
  /** An address fetched again by "Download again": held, but nothing was made or stopped. */
  onAddressRevealed: (link: IssuedPortalLink) => void
  onLinksRevoked: () => void
}>

function useLinkIssuanceState(): PortalLinkIssuance {
  const [issuedLink, setIssuedLink] = useState<IssuedPortalLink | null>(null)
  const [linksRevoked, setLinksRevoked] = useState(false)
  return {
    issuedLink,
    linksRevoked,
    onLinkIssued: (link) => {
      setIssuedLink(link)
      setLinksRevoked(false)
    },
    onAddressRevealed: (link) => {
      setIssuedLink({ ...link, revealed: true })
    },
    onLinksRevoked: () => {
      setIssuedLink(null)
      setLinksRevoked(true)
    },
  }
}

const PortalLinkIssuanceContext = createContext<PortalLinkIssuance | null>(null)

/** Mount once per portal (key it on the portal id) above the workspace's routes. */
export function PortalLinkIssuanceProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const value = useLinkIssuanceState()
  return (
    <PortalLinkIssuanceContext.Provider value={value}>
      {children}
    </PortalLinkIssuanceContext.Provider>
  )
}

/**
 * The shared issuance state, or — outside a provider (stories, isolated
 * renders) — state owned by the calling component, which is what the detail
 * page did before the workspace existed.
 */
export function usePortalLinkIssuance(): PortalLinkIssuance {
  const shared = useContext(PortalLinkIssuanceContext)
  const local = useLinkIssuanceState()
  return shared ?? local
}
