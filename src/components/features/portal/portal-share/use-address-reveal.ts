// "Download again": fetch the live code's address from its sealed copy, once per
// click, and hold it like a made address (ADR 0064). The server records each
// fetch before it decrypts, so this never caches: a second click is a second
// disclosure and a second History entry. Failure is the mutation's own error,
// which the tab's banner already shows, so this resolves to null instead of
// throwing into a click handler.

import { useCallback } from 'react'
import type {
  IssuedPortalLink,
  PortalShareMutations,
  RevealPurpose,
} from './portal-share-types'

type Input = Readonly<{
  portalId: string
  revealMutation: PortalShareMutations['revealMutation']
  onAddressRevealed: (link: IssuedPortalLink) => void
}>

export function useAddressReveal({ portalId, revealMutation, onAddressRevealed }: Input) {
  return useCallback(
    async (purpose: RevealPurpose): Promise<IssuedPortalLink | null> => {
      try {
        const link = await revealMutation({ data: { portalId, purpose } })
        onAddressRevealed(link)
        return link
      } catch {
        return null
      }
    },
    [portalId, revealMutation, onAddressRevealed],
  )
}
