// The Immersive Hub footer's stylesheet, hoisted into the head by the footer
// (React 19 `<style href precedence>`, de-duplicated when a page holds several
// footers). Geometry is measured from boards G01 (notice showing) and G04
// (notice acknowledged: the privacy link on the left, the attribution on the
// right). Colours come from the shell's custom properties. The two softer texts
// are the page's white at FOOTER_TEXT_ALPHA;
// `immersive-footer-styles.test.ts` composites each over the lightest field the
// resolver allows, the painted washes and the brightest photo backdrop, and
// holds 4.5:1 on all of them.

export const IMMERSIVE_FOOTER_STYLE_HREF = 'guest-immersive-footer'

/**
 * The white of the footer's two softer texts, as an alpha: the notice and the
 * attribution. The boards draw them at 66% and 56%, which fails AA on the
 * lightest accepted field (3.8:1 at 56%) and on the peak of a painted wash
 * (the washes are bounded by FULL white text, so a text at less than about 90%
 * cannot hold 4.5:1 there). The hierarchy against the privacy link and "Got
 * it" comes from weight and size instead.
 */
export const FOOTER_TEXT_ALPHA = { notice: 0.92, made: 0.9 } as const

export const IMMERSIVE_FOOTER_CSS = `
.ih-root .ih-footer {
  margin-top: auto;
  padding: 10px 0;
  font-size: 12px;
  line-height: 17px;
}
.ih-root .ih-footer__link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding-inline: 6px;
  font-weight: 600;
}
.ih-root .ih-footer__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-inline: 4px;
}
.ih-root .ih-footer__made {
  margin: 0;
  text-align: end;
  line-height: 16px;
  color: rgba(255, 255, 255, ${FOOTER_TEXT_ALPHA.made});
}
.ih-root .ih-footer__notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.ih-root .ih-footer__text {
  margin: 0;
  max-width: 21rem;
  color: rgba(255, 255, 255, ${FOOTER_TEXT_ALPHA.notice});
}
.ih-root .ih-footer__actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.ih-root .ih-footer__ack {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ih-text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.ih-root .ih-footer__ack-pill {
  display: flex;
  align-items: center;
  min-height: 30px;
  padding-inline: 16px;
  border: 1px solid rgba(255, 255, 255, 0.32);
  border-radius: 999px;
  transition: border-color 150ms ease-out, transform 150ms ease-out;
}
.ih-root .ih-footer__ack:hover .ih-footer__ack-pill { border-color: rgba(255, 255, 255, 0.6); }
.ih-root .ih-footer__ack:active .ih-footer__ack-pill { transform: scale(0.97); }

@media (prefers-reduced-motion: reduce) {
  .ih-root .ih-footer__ack-pill { transition: none; }
  .ih-root .ih-footer__ack:active .ih-footer__ack-pill { transform: none; }
}
`
