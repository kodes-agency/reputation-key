import { parseHexColour } from '#/shared/domain/portal-field-colour'
import { IMMERSIVE_TEXT_COLOUR } from './immersive-look'

// The Linktree's stylesheet, hoisted by `ImmersiveLinktree` apart from the
// shell's: a portal with its Linktree switched off never carries it. Boards G01,
// G09 and G10: two columns, tiles at least 96 px high (they grow with a long
// word), radius 22, an icon disc or a photo, an arrow on every tile.
//
// Text contrast does not depend on the photo, the field or the accent, and
// `linktree-styles.test.ts` computes it for the worst photo there is, a white
// one. On glass the line text is the page text at `lineAlpha`. On a photo tile
// the text block carries its own scrim, fully painted behind the text at any
// tile height, so the photo shows above it and nothing under the words varies.
//
// One rule per line, one selector per rule, so the test can read the file by
// shape. Only `transform` moves.

export const LINKTREE_TEXT = {
  /** The share of the page text colour the tile's second line is drawn at. */
  lineAlpha: 0.9,
  /** The share of the page text colour of the arrow mark. */
  arrowAlpha: 0.7,
  scrimColour: '#0A0E0C',
  scrimAlpha: 0.8,
} as const

const rgba = (hex: string, alpha: number) =>
  `rgba(${(parseHexColour(hex) as readonly number[]).join(', ')}, ${alpha})`

const LINE = rgba(IMMERSIVE_TEXT_COLOUR, LINKTREE_TEXT.lineAlpha)
const ARROW = rgba(IMMERSIVE_TEXT_COLOUR, LINKTREE_TEXT.arrowAlpha)
const SCRIM = rgba(LINKTREE_TEXT.scrimColour, LINKTREE_TEXT.scrimAlpha)

export const LINKTREE_STYLE_HREF = 'guest-immersive-linktree'

export const LINKTREE_CSS = `
.ih-linktree__title { margin: 20px 0 10px 4px; font-size: 22px; line-height: 26px; color: var(--ih-text); }
.ih-linktree__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
.ih-linktree__item { display: flex; min-width: 0; margin: 0; }
.ih-linktree__item:last-child:nth-child(odd) { grid-column: 1 / -1; }

.ih-tile { position: relative; box-sizing: border-box; flex: 1 1 auto; min-width: 0; min-height: 96px; display: flex; flex-direction: column; justify-content: space-between; padding: 12px 13px 10px; border-radius: 22px; }
.ih-tile__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.ih-tile__icon { flex: none; display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 999px; color: var(--ih-accent-text); background: rgba(255, 255, 255, 0.1); background: color-mix(in srgb, var(--ih-accent) 16%, transparent); }
.ih-tile__arrow { flex: none; margin-left: auto; color: ${ARROW}; transition: transform 150ms ease-out; }
.ih-root a.ih-tile:hover .ih-tile__arrow { transform: translate(1px, -1px); }
.ih-tile__text { display: flex; flex-direction: column; min-width: 0; margin-top: 4px; }
.ih-tile__label { font-weight: 600; font-size: 14px; line-height: 18px; color: var(--ih-text); }
.ih-tile__line { font-size: 12px; line-height: 16px; color: ${LINE}; }

.ih-tile--photo { overflow: hidden; justify-content: flex-end; padding: 0; border: 1px solid rgba(255, 255, 255, 0.2); background: var(--ih-glass-solid); cursor: pointer; transition: transform 150ms ease-out; }
.ih-tile--photo .ih-tile__image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform 300ms ease-out; }
.ih-root a.ih-tile--photo:hover { border-color: rgba(255, 255, 255, 0.34); }
.ih-root a.ih-tile--photo:hover .ih-tile__image { transform: scale(1.03); }
.ih-root a.ih-tile--photo:active { transform: scale(0.985); }
.ih-tile--photo .ih-tile__top { position: absolute; top: 9px; right: 9px; }
.ih-tile--photo .ih-tile__arrow { box-sizing: content-box; padding: 6.5px; border-radius: 999px; color: ${rgba(IMMERSIVE_TEXT_COLOUR, 1)}; background: rgba(10, 14, 12, 0.55); }
.ih-tile--photo .ih-tile__text { position: relative; margin: 0; padding: 28px 13px 10px; background: linear-gradient(180deg, transparent 0, ${SCRIM} 28px); }

.ih-tile--inert { cursor: default; }
.ih-root .ih-tile--waiting { border-style: dashed; }
.ih-tile--waiting .ih-tile__line { font-size: 11px; line-height: 14px; letter-spacing: 0.04em; text-transform: uppercase; }

@media (prefers-reduced-motion: reduce) {
  .ih-root .ih-tile__arrow, .ih-root .ih-tile--photo, .ih-root .ih-tile--photo .ih-tile__image { transition: none; }
  .ih-root a.ih-tile:hover .ih-tile__arrow, .ih-root a.ih-tile--photo:hover .ih-tile__image, .ih-root a.ih-tile--photo:active { transform: none; }
}
`
