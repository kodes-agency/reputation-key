// The header's "Open page". When the live page's address can be had again it
// opens the page in a new tab (the reveal is recorded in History as a "show");
// otherwise it is a plain link to Share, where the address is shown or made.

import { Link } from '@tanstack/react-router'
import { ExternalLink, Share2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import type { PortalShareMutations } from '../portal-share/portal-share-types'
import { openLivePage, type BlankTab } from './portal-open-page'

export type PortalOpenPageButtonProps = Readonly<{
  propertyId: string
  portalId: string
  mode: 'reveal' | 'share'
  /** The live code's address when it is already in memory: opened with no reveal. */
  heldAddress?: string | null
  /** Fetches the live code's address; its own refusals are worded by the caller's action (`openPageErrorMessage`). */
  revealMutation: PortalShareMutations['revealMutation']
}>

const POPUP_BLOCKED_MESSAGE =
  'Your browser blocked the new tab. Allow pop-ups for this site, then try again.'
const UNAVAILABLE_MESSAGE =
  'The page could not be opened from here. Open it from the Share tab instead.'

/** A held address opens as a plain new tab; the page cannot reach back into this one. */
function openAddressInNewTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** A new tab the page cannot reach back into (the `noopener` a click would give). */
function openBrowserTab(): BlankTab | null {
  const tab = window.open('', '_blank')
  if (tab === null) return null
  tab.opener = null
  return { navigate: (url) => tab.location.replace(url), close: () => tab.close() }
}

export function PortalOpenPageButton(props: PortalOpenPageButtonProps) {
  const { propertyId, portalId, mode, heldAddress = null, revealMutation } = props
  const [isOpening, setIsOpening] = useState(false)

  if (mode === 'share') {
    return (
      <Button variant="ghost" size="sm" asChild>
        <Link
          to="/properties/$propertyId/portals/$portalId"
          params={{ propertyId, portalId }}
          search={{ tab: 'share' }}
          aria-label="Open page: get its address in Share"
        >
          <Share2 aria-hidden /> Open page
        </Link>
      </Button>
    )
  }

  const open = async () => {
    setIsOpening(true)
    try {
      const outcome = await openLivePage({
        openBlankTab: openBrowserTab,
        reveal: (purpose) => revealMutation({ data: { portalId, purpose } }),
        heldAddress,
        openAddress: openAddressInNewTab,
      })
      if (outcome === 'popup_blocked') toast.error(POPUP_BLOCKED_MESSAGE)
      if (outcome === 'unavailable') toast.error(UNAVAILABLE_MESSAGE)
    } finally {
      setIsOpening(false)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isOpening}
      onClick={() => void open()}
    >
      <ExternalLink aria-hidden /> {isOpening ? 'Opening…' : 'Open page'}{' '}
      <span className="sr-only">(opens in a new tab)</span>
    </Button>
  )
}
