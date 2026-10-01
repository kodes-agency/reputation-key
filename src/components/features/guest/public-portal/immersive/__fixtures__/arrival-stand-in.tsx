// Story-only content for the shell: the real header and title block (slice 13)
// over a stand-in for the rating card and Linktree of boards G01 and G09, so
// the shell can be judged against the boards before those pieces exist
// (slices 14 to 16 replace each part). The footer is the real one (slice 17).
// Uses the shell's glass surfaces and nothing else of the page.
//
// Styled inline on purpose: Tailwind scans `src/` for class names, and a
// stand-in's arbitrary values would be added to the first-paint stylesheet of
// every page in production.

import type { CSSProperties } from 'react'
import { GlassSurface, glassClassName } from '../glass-surface'
import { ImmersiveFooterView } from '../immersive-footer'
import type { ImmersiveFooterCopy } from '../immersive-footer-copy'
import { AvelaChrome, type AvelaChromeProps } from './avela-chrome'

const STARS = [1, 2, 3, 4, 5] as const

const TILES = [
  { label: 'Discover the resort', line: 'Rooms, pools, the sea' },
  { label: 'Spa & treatments', line: 'Book a time' },
  { label: 'Olive Terrace menu', line: 'Lunch and dinner' },
  { label: 'Getting here', line: 'Directions and parking' },
] as const

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
  heading: {
    ...display,
    margin: '20px 0 10px 4px',
    fontSize: 22,
    lineHeight: '26px',
  },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  tile: {
    height: 96,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    padding: '0 13px 11px',
  },
  tileLabel: { fontSize: 14, fontWeight: 600, lineHeight: '18px', color: '#fff' },
  tileLine: { fontSize: 12, lineHeight: '16px', color: 'rgba(255,255,255,0.8)' },
} satisfies Record<string, CSSProperties>

export type ArrivalStandInProps = AvelaChromeProps &
  Readonly<{
    /** The footer's texts, built by the story from a real pack (`immersiveFooterCopy`). */
    footerCopy: ImmersiveFooterCopy
  }>

export function ArrivalStandIn({ footerCopy, ...chrome }: ArrivalStandInProps) {
  const displayName = chrome.displayName ?? 'Avela Resort'
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
      <h2 className="ih-display" style={styles.heading}>
        Around the resort
      </h2>
      <nav aria-label="Useful links" style={styles.tiles}>
        {TILES.map((tile) => (
          <a
            key={tile.label}
            href="#tile"
            className={glassClassName('tile')}
            style={styles.tile}
          >
            <span style={styles.tileLabel}>{tile.label}</span>
            <span style={styles.tileLine}>{tile.line}</span>
          </a>
        ))}
      </nav>
      <ImmersiveFooterView
        copy={footerCopy}
        isNoticeVisible
        onAcknowledge={() => undefined}
      />
    </>
  )
}
