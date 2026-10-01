// Story-only content for the shell: the real header and title block (slice 13)
// over a stand-in for the rating card of boards G01 and G09, so the shell can
// be judged against the boards before that piece exists (slice 14 replaces
// it; the Linktree and the footer are the real ones). Uses the shell's glass
// surfaces and nothing else of the page.
//
// Styled inline on purpose: Tailwind scans `src/` for class names, and a
// stand-in's arbitrary values would be added to the first-paint stylesheet of
// every page in production.

import type { CSSProperties } from 'react'
import { GlassSurface } from '../glass-surface'
import { ImmersiveFooterView } from '../immersive-footer'
import type { ImmersiveFooterCopy } from '../immersive-footer-copy'
import { AvelaChrome, type AvelaChromeProps } from './avela-chrome'
import { ImmersiveLinktree, type ImmersiveLinktreeLink } from '../immersive-linktree'
import { LINKTREE_LINKS_EN } from './linktree-links'

const STARS = [1, 2, 3, 4, 5] as const

const reset: CSSProperties = { margin: 0 }
const display: CSSProperties = { ...reset, color: '#fff' }

const styles = {
  card: { marginTop: 18, padding: '20px 18px 16px' },
  question: {
    ...display,
    marginBottom: 10,
    textAlign: 'center',
    fontSize: 27,
    lineHeight: 1.15,
  },
  stars: { display: 'flex', justifyContent: 'space-between' },
  star: {
    width: 54,
    height: 54,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 30,
  },
  send: {
    marginTop: 14,
    height: 50,
    width: '100%',
    border: 0,
    borderRadius: 999,
    fontSize: 16,
    fontWeight: 600,
    background: 'var(--ih-accent)',
    color: 'var(--ih-on-accent)',
  },
} satisfies Record<string, CSSProperties>

export type ArrivalStandInProps = AvelaChromeProps &
  Readonly<{
    /** The footer's texts, built by the story from a real pack (`immersiveFooterCopy`). */
    footerCopy: ImmersiveFooterCopy
    /** The Linktree's tiles; board G09 passes tiles without a photo. */
    links?: readonly ImmersiveLinktreeLink[]
  }>

export function ArrivalStandIn({
  footerCopy,
  links = LINKTREE_LINKS_EN,
  ...chrome
}: ArrivalStandInProps) {
  return (
    <>
      <AvelaChrome {...chrome} />
      <GlassSurface
        variant="card"
        as="section"
        aria-labelledby="stand-in-question"
        style={styles.card}
      >
        <h2 id="stand-in-question" className="ih-display" style={styles.question}>
          How was your experience?
        </h2>
        <div style={styles.stars} aria-hidden="true">
          {STARS.map((star) => (
            <span key={star} style={styles.star}>
              ☆
            </span>
          ))}
        </div>
        <button type="button" style={styles.send}>
          Send privately
        </button>
      </GlassSurface>
      <ImmersiveLinktree
        enabled
        title={{ value: 'Around the resort', fallbackFrom: null }}
        defaultTitle="Useful links"
        links={links}
        hrefFor={() => '#tile'}
      />
      <ImmersiveFooterView
        copy={footerCopy}
        isNoticeVisible
        onAcknowledge={() => undefined}
      />
    </>
  )
}
