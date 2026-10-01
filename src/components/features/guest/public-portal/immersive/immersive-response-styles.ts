// The stylesheet of the Immersive Hub's response area: the rating card, the
// receipt strip, the Google card and the note card. It is a second hoisted
// stylesheet beside the shell's (`immersive-styles.ts`), for the same reasons:
// the guest page alone needs it, and it is drawn from the shell's custom
// properties (`--ih-accent`, `--ih-on-accent`, `--ih-text`), so every colour it
// uses was checked by `resolveImmersiveLook`.
//
// Geometry is measured from boards G03 to G08 (390 px wide): the card radius 28
// and the star target 54 px (the boards' touch target); the buttons are 52 px,
// the pill of the page. A line that is only there to stay readable on the photo
// uses white at 0.7 or more over the field, which `immersive-look.test.ts`
// holds to the contrast floor for any field the resolver returns.

export const IMMERSIVE_RESPONSE_STYLE_HREF = 'guest-immersive-response'

export const IMMERSIVE_RESPONSE_CSS = `
.ih-response {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 18px;
}
.ih-placeholder, .ih-notice { margin-top: 18px; padding: 22px 20px; }
.ih-notice { text-align: center; }
.ih-placeholder__line, .ih-placeholder__block {
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
  animation: ih-pulse 1.4s ease-in-out infinite;
}
.ih-placeholder__line { width: 70%; height: 24px; }
.ih-placeholder__block { height: 80px; margin-top: 16px; }
@keyframes ih-pulse { 50% { opacity: 0.5; } }

.ih-card-title {
  margin: 0 0 8px;
  font-size: 23px;
  line-height: 1.12;
  color: #fff;
}
.ih-card-title--centered { margin-bottom: 10px; text-align: center; font-size: 27px; line-height: 1.15; }
.ih-card-title--small { margin-bottom: 4px; font-size: 21px; }
.ih-card-body {
  margin: 0;
  font-size: 16px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.88);
  /* Short copy: break at a word, never mid-word ("pri-vately"). A long word still wraps. */
  hyphens: manual;
}

/* The rating card */
.ih-rating-card { padding: 20px 18px 16px; }
.ih-rating-form { display: flex; flex-direction: column; gap: 14px; }
.ih-fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
.ih-fieldset:disabled { opacity: 0.65; }
.ih-stars { display: flex; justify-content: space-between; }
.ih-star {
  width: 54px;
  height: 54px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  cursor: pointer;
  transition: background-color 150ms ease-out, transform 150ms ease-out;
}
.ih-star[data-selected="true"] { background: rgba(255, 255, 255, 0.13); }
.ih-star:has(:focus-visible) { outline: 2px solid var(--ih-accent-text); outline-offset: 2px; }
.ih-star:active { transform: scale(0.94); }
@media (hover: hover) {
  .ih-star:hover { background: rgba(255, 255, 255, 0.09); }
  .ih-star[data-selected="true"]:hover { background: rgba(255, 255, 255, 0.16); }
}
.ih-star__glyph {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linejoin: round;
  color: var(--ih-text);
}
.ih-star__glyph[data-filled="true"] { fill: currentColor; color: var(--ih-accent-text); }
.ih-scale {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: baseline;
  padding: 0 2px;
  font-size: 14px;
  line-height: 20px;
  color: rgba(255, 255, 255, 0.8);
}
.ih-scale__end--high { text-align: end; }
.ih-scale .ih-scale__word {
  min-height: 30px;
  font-size: 25px;
  font-style: italic;
  font-weight: 500;
  line-height: 30px;
  color: var(--ih-accent-text);
}
.ih-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--ih-accent) 50%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--ih-accent) 14%, transparent);
  font-size: 15.5px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ih-accent-text);
}
.ih-banner svg { flex: none; }
.ih-privacy {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 14px 0 0;
  font-size: 14.5px;
  color: rgba(255, 255, 255, 0.82);
}
.ih-privacy svg { flex: none; }

/* Buttons: one pill shape, a filled and an outlined kind */
.ih-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-sizing: border-box;
  width: 100%;
  min-height: 52px;
  padding: 0 22px;
  border: 1px solid transparent;
  border-radius: 999px;
  font: inherit;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  transition: transform 150ms ease-out, filter 150ms ease-out;
}
.ih-button--primary {
  background: var(--ih-accent);
  color: var(--ih-on-accent);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.24);
}
.ih-button--outline {
  border-color: rgba(255, 255, 255, 0.42);
  background: transparent;
  color: var(--ih-text);
}
.ih-button:hover { filter: brightness(1.07); }
.ih-button:active { transform: scale(0.985); }
.ih-button:disabled { opacity: 0.65; cursor: default; filter: none; transform: none; }
.ih-text-button {
  min-height: 44px;
  padding: 0 6px;
  border: 0;
  background: none;
  font: inherit;
  font-weight: 600;
  color: var(--ih-accent-text);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.ih-text-button:disabled { opacity: 0.65; cursor: default; }
.ih-honeypot { position: absolute; left: -9999px; width: 0; height: 0; overflow: hidden; }

/* The receipt strip */
.ih-receipt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding-top: 14px;
  text-align: center;
}
.ih-receipt__thanks {
  margin: 0;
  font-size: 36px;
  line-height: 1.05;
  color: #fff;
  text-shadow: 0 2px 28px rgba(0, 0, 0, 0.4);
}
.ih-receipt__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 2px 10px;
  margin: 0;
  font-size: 15px;
  color: rgba(255, 255, 255, 0.88);
}
.ih-receipt__stars { display: inline-flex; gap: 3px; }

/* The Google card: a warm tint over the glass, the same after every rating */
.ih-google-card {
  padding: 22px 20px 18px;
  background-image: linear-gradient(
    160deg,
    color-mix(in srgb, var(--ih-accent) 22%, transparent),
    color-mix(in srgb, var(--ih-accent) 5%, transparent)
  );
}
.ih-google-card .ih-button { margin-top: 18px; }
.ih-hint {
  margin: 12px 0 0;
  text-align: center;
  font-size: 13.5px;
  color: rgba(255, 255, 255, 0.74);
}
.ih-google-card .ih-banner { margin-top: 12px; }
.ih-google-card--unavailable {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px 18px;
}
.ih-disc {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.13);
  color: var(--ih-accent-text);
}

/* The private note card */
.ih-note {
  box-sizing: border-box;
  padding: 20px 18px;
  border: 1.5px dashed rgba(255, 255, 255, 0.36);
  border-radius: 28px;
  background: rgba(8, 10, 9, 0.22);
}
.ih-note--sent { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 24px; }
.ih-note--sent p { margin: 0; font-size: 16px; line-height: 1.35; }
.ih-note__hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px;
  font-size: 14.5px;
  color: rgba(255, 255, 255, 0.82);
}
.ih-note__hint svg { flex: none; }
.ih-note__form { display: flex; flex-direction: column; gap: 8px; }
.ih-note__label { font-size: 15px; font-weight: 600; }
.ih-note__field {
  box-sizing: border-box;
  width: 100%;
  min-height: 120px;
  padding: 14px 16px;
  border: 1.5px solid rgba(255, 255, 255, 0.34);
  border-radius: 18px;
  background: rgba(0, 0, 0, 0.3);
  font: inherit;
  font-size: 17px;
  line-height: 1.4;
  color: var(--ih-text);
  resize: vertical;
}
.ih-note__field:focus { border-color: var(--ih-accent); }
.ih-note__field[aria-invalid="true"] { border-color: var(--ih-accent-text); }
.ih-note__fine { margin: 0; font-size: 14px; color: rgba(255, 255, 255, 0.78); }
.ih-note__actions { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.ih-note__actions .ih-button { flex: 1 1 auto; width: auto; }

@media (prefers-reduced-motion: reduce) {
  .ih-star, .ih-button { transition: none; }
  .ih-star:active, .ih-button:active { transform: none; }
  .ih-placeholder__line, .ih-placeholder__block { animation: none; }
}
`
