// fallow-ignore-file code-duplication
// The preview page's inline styles, measured from the round-4 guest boards (390
// px wide) the same way the shell's story stand-in was. Inline on purpose: the
// first-paint stylesheet is built by scanning `src/` for class names, and a
// page-specific arbitrary value would be added to the stylesheet of every page
// in production. The shell supplies the glass, the colours and the fonts; these
// only place things inside it.

import type { CSSProperties } from 'react'

const reset: CSSProperties = { margin: 0 }
const display: CSSProperties = { ...reset, color: '#fff' }

export const previewStyles = {
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
  logo: { display: 'block', height: 32, width: 'auto', maxWidth: 160 },
  chip: {
    height: 44,
    padding: '0 13px 0 12px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
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
  heading: {
    ...display,
    margin: '20px 0 10px 4px',
    fontSize: 22,
    lineHeight: '26px',
  },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  tile: {
    minHeight: 96,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    padding: '12px 13px 11px',
    textAlign: 'left',
    color: '#fff',
    font: 'inherit',
  },
  tileWaiting: { borderStyle: 'dashed', color: 'rgba(255,255,255,0.78)' },
  tileIcon: { marginBottom: 'auto', color: 'var(--ih-accent-text)' },
  tileLabel: { fontSize: 14, fontWeight: 600, lineHeight: '18px' },
  tileLine: { fontSize: 12, lineHeight: '16px', color: 'rgba(255,255,255,0.8)' },
  tileWaitingNote: {
    fontSize: 11,
    lineHeight: '14px',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--ih-accent-text)',
  },
  footer: {
    marginTop: 'auto',
    padding: '20px 0 10px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  notice: {
    ...reset,
    maxWidth: 260,
    fontSize: 12,
    lineHeight: '17px',
    color: 'rgba(255,255,255,0.66)',
  },
  footerLine: {
    ...reset,
    marginTop: 4,
    fontSize: 12,
    color: 'rgba(255,255,255,0.66)',
  },
} satisfies Record<string, CSSProperties>
