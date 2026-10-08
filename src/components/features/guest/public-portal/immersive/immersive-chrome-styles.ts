// The stylesheet of the page's top: the header (wordmark or logo and the
// language chip), the title block and the language sheet. It is appended to the
// shell's stylesheet (`immersive-styles.ts`), which explains why these rules
// are a string. Like the shell's, they live in the `ih-` class namespace.
//
// Geometry is measured from boards G01 and G02 (390 x 844): a 64 px header, a
// 44 px chip, the title block 78 px below it, a 26 px sheet title and 60 px rows.

import { HERO_PHONE_HEIGHT, HERO_TITLE_CLEARANCE } from './immersive-hero-scrim'

/**
 * The wordmark's room beside the chip, from the header's width, for the fit
 * below: the chip (90 px), the gap (12) and the header's padding (8), with a
 * little over. Without a chip, nothing but the padding and a little over.
 */
const WORDMARK_RESERVE = { withChip: 114, alone: 10 } as const
/**
 * How wide one letter of an uppercase wordmark is, in em, before its spacing:
 * measured on Cormorant Garamond 600 across ordinary names (0.60), and a little
 * more, so a name of wide letters still fits.
 */
const WORDMARK_LETTER_EM = 0.64

export const IMMERSIVE_CHROME_CSS = `
.ih-header {
  flex-shrink: 0;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 0 2px 0 6px;
  /* The wordmark sizes itself to the room this leaves it (cqw below). */
  container-type: inline-size;
}
/* The brand mark is never cut off. It is as large and as widely spaced as the
   room beside the chip allows, and steps down in size and then in spacing as the
   name gets longer or the phone narrower; only a name too long even for that
   wraps to a second line. Nothing ends in an ellipsis. */
.ih-wordmark {
  --ih-wm-reserve: ${WORDMARK_RESERVE.withChip}px;
  margin: 0 auto 0 0;
  min-width: 0;
  font-size: 16px;
  line-height: 1.15;
  letter-spacing: 0.38em;
  text-transform: uppercase;
  /* The root's overflow-wrap (break-word) breaks a name too long for any size
     inside its word; a brand mark is never hyphenated. */
  hyphens: manual;
  color: #fff;
  text-shadow: 0 1px 10px rgba(0, 0, 0, 0.5);
}
.ih-header:not(:has(.ih-chip)) .ih-wordmark { --ih-wm-reserve: ${WORDMARK_RESERVE.alone}px; }
@supports (width: 1cqw) {
  .ih-wordmark {
    --ih-wm-room: calc((100cqw - var(--ih-wm-reserve)) / var(--ih-wm-n, 1));
    --ih-wm-size: clamp(11px, calc(var(--ih-wm-room) * 0.95), 16px);
    font-size: var(--ih-wm-size);
    letter-spacing: clamp(0.4px, calc(var(--ih-wm-room) - ${WORDMARK_LETTER_EM} * var(--ih-wm-size)), 0.38em);
  }
}
.ih-logo {
  display: block;
  height: 32px;
  width: auto;
  max-width: 55%;
  margin-right: auto;
  object-fit: contain;
  object-position: left center;
}
.ih-chip {
  flex-shrink: 0;
  height: 44px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 13px 0 12px;
  color: var(--ih-text);
  font-family: var(--ih-body);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
}

.ih-title {
  /* The hero's height less ${HERO_TITLE_CLEARANCE}px: 78 px on a phone, and the same place on the photo when it grows. */
  margin-top: calc(var(--ih-hero-h, ${HERO_PHONE_HEIGHT}px) - ${HERO_TITLE_CLEARANCE}px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}
.ih-title__kicker {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  text-wrap: balance;
  color: var(--ih-accent-text);
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.5);
}
/* Over a photo the kicker's colour is the accent only where it is readable on the brightest photo (immersive-look.ts). */
.ih-root[data-ih-surface='photo'] .ih-title__kicker { color: var(--ih-kicker-photo); }
.ih-title__name {
  margin: 0;
  font-size: clamp(34px, 11.3vw, 44px);
  line-height: 1.04;
  letter-spacing: -0.005em;
  text-wrap: balance;
  color: #fff;
  text-shadow: 0 2px 30px rgba(0, 0, 0, 0.45);
}

/* The sheet is a native modal dialog: it sits in the top layer, so it needs no
   z-index, and the page behind it is inert. It is anchored to the bottom and
   keeps the page's column width on a wide screen. */
.ih-sheet {
  position: fixed;
  inset: auto 0 0 0;
  margin: 0 auto;
  width: 100%;
  max-width: 30rem;
  max-height: none;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ih-text);
  overflow: visible;
}
.ih-sheet::backdrop {
  background: rgba(4, 6, 5, 0.52);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
}
/* The page behind a modal dialog still scrolls by default. */
body:has(.ih-root--page .ih-sheet[open]) { overflow: hidden; }
.ih-sheet__panel {
  box-sizing: border-box;
  max-height: 92dvh;
  overflow-y: auto;
  padding: 10px 16px calc(22px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 28px 28px 0 0;
  background: rgba(24, 27, 24, 0.84);
  -webkit-backdrop-filter: blur(28px) saturate(1.3);
  backdrop-filter: blur(28px) saturate(1.3);
  box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.42);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .ih-sheet__panel { background: var(--ih-glass-solid); }
}
.ih-sheet__grab {
  width: 40px;
  height: 5px;
  margin: 0 auto 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
}
.ih-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-left: 6px;
}
.ih-sheet__title {
  margin: 0;
  font-size: 26px;
  line-height: 30px;
  color: #fff;
}
.ih-sheet__close {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: var(--ih-text);
  cursor: pointer;
}
.ih-sheet__close:hover { background: rgba(255, 255, 255, 0.18); }
.ih-sheet__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.ih-sheet__row {
  --ih-link-colour: #fff;
  min-height: 60px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: 18px;
  color: #fff;
}
.ih-sheet__row:hover { background: rgba(255, 255, 255, 0.07); }
.ih-sheet__row[aria-current='page'] {
  border-color: color-mix(in srgb, var(--ih-accent-text) 32%, transparent);
  background: color-mix(in srgb, var(--ih-accent-text) 14%, transparent);
}
.ih-sheet__row[aria-current='page'] svg { flex-shrink: 0; color: var(--ih-accent-text); }
.ih-sheet__text { display: flex; flex-direction: column; min-width: 0; }
.ih-sheet__name { font-size: 16px; line-height: 20px; font-weight: 600; }
.ih-sheet__aside {
  font-size: 12px;
  line-height: 16px;
  color: rgba(255, 255, 255, 0.64);
}
.ih-sheet__hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 6px 0;
  font-size: 12px;
  line-height: 17px;
  color: rgba(255, 255, 255, 0.62);
}
.ih-sheet__hint svg { flex-shrink: 0; }

/* The sheet as the admin's preview draws it: not a dialog and not in the top
   layer, but open on the phone's first screen (its height is set inline) over
   the dimmed page, with the panel at the bottom as on the guest's phone. */
.ih-sheet-scene {
  position: absolute;
  inset: 0 0 auto 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
}
.ih-sheet-scene__scrim {
  position: absolute;
  inset: 0;
  background: rgba(4, 6, 5, 0.52);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
}
.ih-sheet-scene__sheet {
  position: relative;
  width: 100%;
  max-width: 30rem;
  margin: 0 auto;
}
.ih-sheet-scene .ih-sheet__panel { max-height: none; overflow: visible; }

@media (prefers-reduced-motion: no-preference) {
  .ih-sheet[open] .ih-sheet__panel { animation: ih-sheet-in 240ms cubic-bezier(0.16, 1, 0.3, 1); }
  .ih-sheet[open]::backdrop { animation: ih-sheet-fade 200ms ease-out; }
}
@keyframes ih-sheet-in { from { transform: translateY(28px); } }
@keyframes ih-sheet-fade { from { opacity: 0; } }
`
