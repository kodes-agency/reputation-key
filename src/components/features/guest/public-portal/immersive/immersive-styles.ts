import { BACKDROP_WASH_ALPHA } from '#/shared/domain/portal-field-colour'
import { IMMERSIVE_CHROME_CSS } from './immersive-chrome-styles'
import {
  HERO_PHONE_HEIGHT,
  HERO_TITLE_SCRIM,
  HERO_TITLE_SCRIM_HALF_WIDTH,
  HERO_TOP_SCRIM,
  HERO_WIDE,
  photoMaskGradient,
  scrimGradient,
  scrimReach,
} from './immersive-hero-scrim'
import { PHOTO_BACKDROP } from './immersive-look'

// The Immersive Hub's stylesheet, as one string the shell hoists into the
// document head (React 19 `<style href precedence>`, which also de-duplicates
// it when a page holds several shells, as the admin preview list does).
//
// Why a string here and not `styles.css`: that file is the first-paint
// stylesheet of every page, and this one is needed on the guest page alone.
// Why not Tailwind utilities: the glass, the `@supports` fallback and the
// neutralising rules below are not expressible as utilities, and the page is
// drawn from custom properties the resolver sets (`immersive-look.ts`).
//
// Everything is scoped under `.ih-root`. The three rules that answer the app's
// global styles are marked NEUTRALISE, because they exist only because those
// globals reach a page that must not look like the app:
//
//   - `a { color: var(--accent) }` is a global default in `@layer base`. Any
//     unlayered rule here already beats it, but a page that must not look like
//     the app should not hang on layer order, and a utility or a stray class
//     must not recolour an anchor either.
//     `!important` is the deliberate choice instead, confined to `color` and
//     `text-decoration` on anchors inside the root: no class can recolour an
//     anchor by accident, and a link chooses its colour through the
//     `--ih-link-*` custom properties, never by fighting the cascade.
//   - `html.dark` / `html.light` (the theme script) set `color-scheme` and the
//     app's surface tokens. The page is always dark, so the root reads none of
//     those tokens, and a PAGE-height shell pins `color-scheme: dark` and the
//     body colour on the document. A shell in a frame (the admin preview)
//     must not: the document there belongs to the app.
//   - `body { overflow-wrap: anywhere }` lets flex items shrink below their
//     longest word, which broke long German words mid-letter; the root sets
//     `break-word` (which does not change min-content) and hyphenates by the
//     document language instead.

export const IMMERSIVE_STYLE_HREF = 'guest-immersive'

const percent = (share: number) => `${Math.round(share * 100)}%`

const { solid, gone } = HERO_TITLE_SCRIM_HALF_WIDTH
const titleScrimFade = `linear-gradient(90deg, transparent calc(50% - ${gone}px), #000 calc(50% - ${solid}px), #000 calc(50% + ${solid}px), transparent calc(50% + ${gone}px))`

// Geometry measured from boards G01 and G09 (390 x 844): the hero is 236 px
// tall on a phone, the glass card radius 28, the tiles 22, the chip a pill. The
// hero's fade and its two scrims are in `immersive-hero-scrim.ts`, which also
// proves that the text on them stays legible over the brightest photo.
export const IMMERSIVE_CSS = `
.ih-root {
  --ih-accent-text: color-mix(in srgb, var(--ih-accent) 88%, #fff);
  --ih-hero-h: ${HERO_PHONE_HEIGHT}px;
  --ih-display: var(--font-guest-display, 'Cormorant Garamond', Georgia, 'Times New Roman', serif);
  --ih-body: var(--font-guest-body, 'Ysabeau Office', system-ui, -apple-system, 'Segoe UI', sans-serif);
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  background-color: var(--ih-field);
  color: var(--ih-text);
  font-family: var(--ih-body);
  color-scheme: dark;
  /* NEUTRALISE the body's line breaking, which lets a word break at any letter. */
  overflow-wrap: break-word;
  word-break: normal;
  hyphens: auto;
  -webkit-text-size-adjust: 100%;
}
.ih-root--container { min-height: 100%; }

/* NEUTRALISE the theme class on html: the page is dark whatever the script chose.
   Page height only: a shell in a frame sits inside the app's own document. */
:root:has(.ih-root--page) { color-scheme: dark !important; }
body:has(.ih-root--page) { background-color: #0d1210; }

/* NEUTRALISE the global anchor colour. */
.ih-root a {
  color: var(--ih-link-colour, inherit) !important;
  text-decoration: var(--ih-link-decoration, none) !important;
}
.ih-root a:hover {
  color: var(--ih-link-hover-colour, var(--ih-link-colour, inherit)) !important;
}
.ih-link-accent {
  --ih-link-colour: var(--ih-accent-text);
  --ih-link-hover-colour: color-mix(in srgb, var(--ih-accent-text) 55%, #fff);
  --ih-link-decoration: underline;
  text-underline-offset: 3px;
}

.ih-root :is(a, button, input, textarea, select, summary):focus-visible {
  outline: 2px solid var(--ih-accent-text);
  outline-offset: 3px;
}
.ih-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.ih-display {
  font-family: var(--ih-display);
  font-weight: 600;
}

.ih-backdrop {
  position: absolute;
  inset: 0;
  z-index: -2;
  overflow: hidden;
  pointer-events: none;
}
.ih-backdrop__photo {
  position: absolute;
  inset: -90px;
  width: calc(100% + 180px);
  height: calc(100% + 180px);
  object-fit: cover;
  object-position: var(--ih-focal, 50% 62%);
  filter: blur(36px) saturate(1.35) brightness(${PHOTO_BACKDROP.brightness});
}
.ih-backdrop__wash { position: absolute; inset: 0; }
.ih-backdrop__wash--photo {
  background:
    radial-gradient(circle at 12% 88%, color-mix(in srgb, var(--ih-wash-warm) ${percent(PHOTO_BACKDROP.warmWash)}, transparent) 0%, transparent 46%),
    radial-gradient(circle at 96% 58%, color-mix(in srgb, var(--ih-wash-cool) ${percent(PHOTO_BACKDROP.coolWash)}, transparent) 0%, transparent 42%),
    color-mix(in srgb, var(--ih-field) ${percent(PHOTO_BACKDROP.fieldMix)}, transparent);
}
.ih-backdrop__wash--field {
  background:
    radial-gradient(120% 55% at 18% 0%, color-mix(in srgb, var(--ih-wash-warm) ${percent(BACKDROP_WASH_ALPHA.warm)}, transparent) 0%, transparent 62%),
    radial-gradient(90% 50% at 100% 36%, color-mix(in srgb, var(--ih-wash-cool) ${percent(BACKDROP_WASH_ALPHA.cool)}, transparent) 0%, transparent 64%),
    radial-gradient(120% 60% at 30% 100%, color-mix(in srgb, var(--ih-wash-deep) ${percent(BACKDROP_WASH_ALPHA.deep)}, transparent) 0%, transparent 70%),
    var(--ih-field);
}
.ih-backdrop__grain {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.1;
  mix-blend-mode: overlay;
}

.ih-hero {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: -1;
  height: var(--ih-hero-h);
  pointer-events: none;
}
.ih-hero__image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: var(--ih-focal, 50% 42%);
  -webkit-mask-image: ${photoMaskGradient()};
  mask-image: ${photoMaskGradient()};
}
/* Keep the wordmark and the title legible over any photo, even a white one. */
.ih-hero__scrim { position: absolute; left: 0; right: 0; }
.ih-hero__scrim--top {
  top: 0;
  height: ${scrimReach(HERO_TOP_SCRIM)}px;
  background: ${scrimGradient(HERO_TOP_SCRIM, true)};
}
.ih-hero__scrim--title {
  bottom: 0;
  height: ${scrimReach(HERO_TITLE_SCRIM)}px;
  background: ${scrimGradient(HERO_TITLE_SCRIM, false)};
  /* Solid behind the title's column, fading out beyond it on a wide screen. */
  -webkit-mask-image: ${titleScrimFade};
  mask-image: ${titleScrimFade};
}
/* From sm up the photo grows with the viewport instead of becoming a thin strip.
   The title block follows it down (its margin is the hero's height), so the
   text keeps the same place on the photo. Only the page height asks the
   viewport: a shell in a frame (the admin preview) is a phone whatever the window. */
@media (min-width: ${HERO_WIDE.minWidth}px) {
  .ih-root--page[data-ih-surface='photo'] {
    --ih-hero-h: clamp(${HERO_WIDE.minHeight}px, ${HERO_WIDE.vw}vw, ${HERO_WIDE.maxHeight}px);
  }
}
.ih-arch {
  position: absolute;
  top: 0;
  left: 50%;
  z-index: -1;
  width: 390px;
  max-width: none;
  height: 250px;
  transform: translateX(-50%);
  color: var(--ih-accent-text);
  pointer-events: none;
}

.ih-column {
  position: relative;
  z-index: 0;
  flex: 1 1 auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 30rem;
  margin-inline: auto;
  padding-inline: 16px;
}

.ih-glass {
  border: 1px solid var(--ih-glass-border);
  background: var(--ih-glass-bg);
  -webkit-backdrop-filter: var(--ih-glass-filter);
  backdrop-filter: var(--ih-glass-filter);
  box-shadow: var(--ih-glass-shadow, none);
}
.ih-glass--card {
  --ih-glass-bg: rgba(255, 255, 255, 0.1);
  --ih-glass-border: rgba(255, 255, 255, 0.2);
  --ih-glass-filter: blur(22px) saturate(1.4);
  --ih-glass-shadow: 0 24px 60px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.16);
  border-radius: 28px;
}
.ih-glass--tile {
  --ih-glass-bg: rgba(255, 255, 255, 0.08);
  --ih-glass-border: rgba(255, 255, 255, 0.16);
  --ih-glass-filter: blur(18px) saturate(1.3);
  border-radius: 22px;
}
.ih-glass--chip {
  --ih-glass-bg: rgba(16, 20, 18, 0.34);
  --ih-glass-border: rgba(255, 255, 255, 0.24);
  --ih-glass-filter: blur(14px);
  border-radius: 999px;
}
a.ih-glass--tile, button.ih-glass--tile, button.ih-glass--chip { cursor: pointer; transition: transform 150ms ease-out; }
/* Hover brightens the rim only, so the opaque @supports fallback below keeps its fill. */
a.ih-glass--tile:hover, button.ih-glass--tile:hover { --ih-glass-border: rgba(255, 255, 255, 0.34); }
button.ih-glass--chip:hover { --ih-glass-border: rgba(255, 255, 255, 0.4); }
a.ih-glass--tile:active, button.ih-glass--tile:active, button.ih-glass--chip:active { transform: scale(0.985); }

/* Without backdrop-filter the translucent white would sit straight on the
   photo. Use the resolver's opaque, field-derived fill so text keeps its
   contrast. A literal hex on purpose: the browsers that lack backdrop-filter
   also lack color-mix, which would leave the glass transparent. */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .ih-glass {
    --ih-glass-bg: var(--ih-glass-solid);
    --ih-glass-border: rgba(255, 255, 255, 0.24);
  }
}

/* The app's body selection colour is purple; the page selects in its accent. */
.ih-root ::selection {
  background: color-mix(in srgb, var(--ih-accent) 45%, transparent);
  color: var(--ih-text);
}

@media (prefers-reduced-motion: reduce) {
  .ih-root .ih-glass { transition: none; }
  .ih-root a.ih-glass--tile:active, .ih-root button.ih-glass--tile:active, .ih-root button.ih-glass--chip:active { transform: none; }
}${IMMERSIVE_CHROME_CSS}`
