// A whole Immersive Hub page, for the quality gate: the real shell at page
// height (the document scrolls, as on the public route), the real header and
// title block, the real rating card, the real Linktree and the real footer. The
// route mounts the same pieces for a v3 snapshot (`ImmersivePublicPortal`); this
// composition stays so the quality gate can place them in a story, with a story
// photo and no session. Stories only.

import { useEffect, useState } from 'react'
import type { GuestPagePreviewState } from '../../guest-page-preview-state'
import type { GuestPortalCopyV2 } from '../../language-packs/guest-copy-v2'
import { enV2 } from '../../language-packs/en-v2'
import { ImmersiveFooterView } from '../immersive-footer'
import { immersiveFooterCopy, type ImmersiveFooterCopy } from '../immersive-footer-copy'
import { ImmersiveLinktree, type ImmersiveLinktreeLink } from '../immersive-linktree'
import { immersiveResponseProps } from '../immersive-response-preview'
import { ImmersiveResponseView } from '../immersive-response-view'
import { ImmersiveShell } from '../immersive-shell'
import { AvelaChrome, type AvelaChromeProps } from './avela-chrome'
import { LINKTREE_LINKS_EN } from './linktree-links'
import { STORY_HERO_PHOTO } from './story-hero-photo'

const CHAMPAGNE = { accentColour: '#EAD6A8', fieldColour: '#15110D' } as const
const DISPLAY_NAME = 'Avela Resort'
const noop = () => undefined

/**
 * How the footer starts. `swaps-after-paint` is the server's footer: the
 * server cannot read `localStorage`, so it paints the one-row acknowledged
 * footer, and a guest who has not acknowledged sees it swap to the taller
 * notice once the page has hydrated. The story paints the row first, then
 * shows the notice two frames later, which is the same two paints.
 */
export type FooterStart = 'acknowledged' | 'notice' | 'swaps-after-paint'

export type GuestPageCompositionProps = Readonly<{
  withPhoto: boolean
  chrome?: AvelaChromeProps
  state?: GuestPagePreviewState
  /** The pack the rating card and the footer speak. */
  pack?: GuestPortalCopyV2
  footerStart?: FooterStart
  footerCopy?: Partial<ImmersiveFooterCopy>
  links?: readonly ImmersiveLinktreeLink[]
  linktreeTitle?: string
}>

function FooterAfterPaint({ copy }: Readonly<{ copy: ImmersiveFooterCopy }>) {
  const [isNoticeVisible, setNoticeVisible] = useState(false)
  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setNoticeVisible(true))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [])
  return (
    <ImmersiveFooterView
      copy={copy}
      isNoticeVisible={isNoticeVisible}
      onAcknowledge={noop}
    />
  )
}

export function GuestPageComposition({
  withPhoto,
  chrome,
  state = { kind: 'arrival' },
  pack = enV2,
  footerStart = 'acknowledged',
  footerCopy,
  links = LINKTREE_LINKS_EN,
  linktreeTitle = 'Around the resort',
}: GuestPageCompositionProps) {
  const copy = { ...immersiveFooterCopy(pack, DISPLAY_NAME), ...footerCopy }
  const props = immersiveResponseProps(state, { pack, displayName: DISPLAY_NAME })
  return (
    <ImmersiveShell
      brand={{ ...CHAMPAGNE, hero: withPhoto ? STORY_HERO_PHOTO : null }}
      heroAlt={{
        value: withPhoto ? 'The colonnade pool at dusk, under an old olive tree' : '',
      }}
      lang={chrome?.locale ?? pack.locale}
      height="page"
    >
      <AvelaChrome {...chrome} />
      <ImmersiveResponseView {...props} />
      <ImmersiveLinktree
        enabled
        title={{ value: linktreeTitle, fallbackFrom: null }}
        defaultTitle={pack.copy.linktreeDefaultTitle}
        links={links}
        hrefFor={() => '#tile'}
      />
      {footerStart === 'swaps-after-paint' ? (
        <FooterAfterPaint copy={copy} />
      ) : (
        <ImmersiveFooterView
          copy={copy}
          isNoticeVisible={footerStart === 'notice'}
          onAcknowledge={noop}
        />
      )}
    </ImmersiveShell>
  )
}
