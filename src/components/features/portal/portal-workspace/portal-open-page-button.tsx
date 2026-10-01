// The header's "Open page". When the live page's address can be had again it
// opens the page in a new tab (the reveal is recorded in History as a "show");
// otherwise it is a plain link to Share, where the address is shown or made.

import { Link } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import type { PortalShareMutations } from '../portal-share/portal-share-types'
import { openLivePage, type BlankTab, type OpenPageMode } from './portal-open-page'

export type PortalOpenPageButtonProps = Readonly<{
  propertyId: string
  portalId: string
  mode: OpenPageMode
  /** Fetches the live code's address. Its own failures are reported by the caller's action. */
  revealMutation: PortalShareMutations['revealMutation']
}>

const POPUP_BLOCKED_MESSAGE =
  'Your browser blocked the new tab. Allow pop-ups for this site, then try again.'
const UNAVAILABLE_MESSAGE =
  'The page could not be opened from here. Open it from the Share tab instead.'

/** A new tab the page cannot reach back into (the `noopener` a click would give). */
function openBrowserTab(): BlankTab | null {
  const tab = window.open('', '_blank')
  if (tab === null) return null
  tab.opener = null
  return { navigate: (url) => tab.location.replace(url), close: () => tab.close() }
}

export function PortalOpenPageButton(props: PortalOpenPageButtonProps) {
  const { propertyId, portalId, mode, revealMutation } = props
  const [isOpening, setIsOpening] = useState(false)
  const buttonClass = 'min-h-11 sm:min-h-8'

  if (mode === 'share') {
    return (
      <Button variant="outline" size="sm" asChild className={buttonClass}>
        <Link
          to="/properties/$propertyId/portals/$portalId"
          params={{ propertyId, portalId }}
          search={{ tab: 'share' }}
        >
          <ExternalLink aria-hidden /> Open page
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
      variant="outline"
      size="sm"
      className={buttonClass}
      disabled={isOpening}
      onClick={() => void open()}
    >
      <ExternalLink aria-hidden /> {isOpening ? 'Opening…' : 'Open page'}
    </Button>
  )
}
