// Story-only content for the shell: a stand-in for the header, title block,
// rating card, Linktree and footer of boards G01 and G09, so the shell can be
// judged against the boards before those pieces exist (slices 13 to 17 replace
// each part). Uses the shell's glass surfaces and nothing else of the page.
//
// Styled inline on purpose: Tailwind scans `src/` for class names, and a
// stand-in's arbitrary values would be added to the first-paint stylesheet of
// every page in production.

import type { CSSProperties } from 'react'
import { GlassSurface, glassClassName } from '../glass-surface'

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
  header: {
    height: 64,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 2px 0 6px',
  },
  wordmark: {
    ...display,
    fontSize: 16,
    letterSpacing: '0.38em',
    textTransform: 'uppercase',
  },
  chip: {
    height: 44,
    padding: '0 13px 0 12px',
    color: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.06em',
  },
  titleBlock: {
    marginTop: 78,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    textAlign: 'center',
  },
  kicker: {
    ...reset,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: '14px',
    letterSpacing: '0.3em',
    textTransform: 'uppercase',
    color: 'var(--ih-accent-text)',
  },
  name: {
    ...display,
    fontSize: 44,
    lineHeight: 1,
    textShadow: '0 2px 30px rgba(0,0,0,0.45)',
  },
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
  footer: {
    marginTop: 'auto',
    padding: '10px 0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  notice: {
    ...reset,
    maxWidth: 250,
    fontSize: 12,
    lineHeight: '17px',
    color: 'rgba(255,255,255,0.66)',
  },
  privacy: {
    height: 44,
    display: 'flex',
    alignItems: 'center',
    padding: '0 6px',
    fontSize: 12,
    fontWeight: 600,
  },
} satisfies Record<string, CSSProperties>

export function ArrivalStandIn({ displayName }: Readonly<{ displayName: string }>) {
  return (
    <>
      <header style={styles.header}>
        <p className="ih-display" style={styles.wordmark}>
          Avela
        </p>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label="Language: English"
          className={glassClassName('chip')}
          style={styles.chip}
        >
          EN
        </button>
      </header>
      <div style={styles.titleBlock}>
        <h1 style={styles.kicker}>Pool &amp; Terrace</h1>
        <p className="ih-display" style={styles.name}>
          {displayName}
        </p>
      </div>
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
      <footer style={styles.footer}>
        <p style={styles.notice}>
          This page counts visits for {displayName}. No ads or third-party trackers.
        </p>
        <a href="#privacy" className="ih-link-accent" style={styles.privacy}>
          Privacy notice
        </a>
      </footer>
    </>
  )
}
