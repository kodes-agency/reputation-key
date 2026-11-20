// Story-only chrome around the response area: the header and title block above
// it and the Linktree and footer below it, so the cards can be judged against
// boards G03 to G08. Slices 13 (header, title), 15 (Linktree) and 17 (footer)
// build the real parts. Styled inline on purpose: Tailwind scans `src/` for
// class names, and a stand-in's values would join every page's first paint.

import type { CSSProperties, ReactNode } from 'react'
import { glassClassName } from '../glass-surface'

const TILES = [
  { label: 'Discover the resort', line: 'Rooms, pools, the sea' },
  { label: 'Spa & treatments', line: 'Book a time' },
  { label: 'Olive Terrace menu', line: 'Lunch and dinner' },
  { label: 'Getting here', line: 'Directions and parking' },
] as const

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
    margin: 0,
    color: '#fff',
    fontSize: 16,
    letterSpacing: '0.38em',
    textTransform: 'uppercase',
  },
  chip: {
    height: 44,
    padding: '0 13px',
    color: 'inherit',
    fontSize: 13,
    fontWeight: 600,
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
    margin: 0,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.3em',
    textTransform: 'uppercase',
    color: 'var(--ih-accent-text)',
  },
  name: { margin: 0, color: '#fff', fontSize: 44, lineHeight: 1 },
  heading: { margin: '22px 0 10px 4px', color: '#fff', fontSize: 22, lineHeight: '26px' },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  tile: {
    height: 96,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    padding: '0 13px 11px',
  },
  tileLabel: { fontSize: 14, fontWeight: 600, color: '#fff' },
  tileLine: { fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  footer: {
    marginTop: 'auto',
    padding: '24px 0 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 12,
  },
  // The real footer's link is a 44 px target (`immersive-footer-styles.ts`).
  privacy: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 44,
    paddingInline: 6,
  },
} satisfies Record<string, CSSProperties>

type Props = Readonly<{
  kicker: string
  language: string
  linktreeTitle: string
  privacy: string
  madeWith: string
  children: ReactNode
}>

export function ResponsePageStandIn({
  kicker,
  language,
  linktreeTitle,
  privacy,
  madeWith,
  children,
}: Props) {
  return (
    <>
      <header style={styles.header}>
        <p className="ih-display" style={styles.wordmark}>
          Avela
        </p>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={language}
          className={glassClassName('chip')}
          style={styles.chip}
        >
          {language.slice(0, 2).toUpperCase()}
        </button>
      </header>
      <div style={styles.titleBlock}>
        <h1 style={styles.kicker}>{kicker}</h1>
        <p className="ih-display" style={styles.name}>
          Avela Resort
        </p>
      </div>
      {children}
      <h2 className="ih-display" style={styles.heading}>
        {linktreeTitle}
      </h2>
      <nav aria-label={linktreeTitle} style={styles.tiles}>
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
        <a href="#privacy" className="ih-link-accent" style={styles.privacy}>
          {privacy}
        </a>
        <span style={{ color: 'rgba(255,255,255,0.7)' }}>{madeWith}</span>
      </footer>
    </>
  )
}
