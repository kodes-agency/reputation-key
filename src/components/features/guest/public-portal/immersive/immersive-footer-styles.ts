// The Immersive Hub footer's stylesheet, hoisted into the head by the footer
// (React 19 `<style href precedence>`, de-duplicated when a page holds several
// footers). Geometry is measured from boards G01 (notice showing) and G04
// (notice acknowledged: the privacy link on the left, the attribution on the
// right). Colours come from the shell's custom properties; the two grey texts
// are the boards' white at 66% and 56%, both above 4.5:1 on the darkest and the
// lightest field the resolver allows.

export const IMMERSIVE_FOOTER_STYLE_HREF = 'guest-immersive-footer'

export const IMMERSIVE_FOOTER_CSS = `
.ih-root .ih-footer {
  margin-top: auto;
  padding: 10px 0;
  font-size: 12px;
  line-height: 17px;
}
.ih-footer__link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding-inline: 6px;
  font-weight: 600;
}
.ih-footer__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-inline: 4px;
}
.ih-footer__made {
  margin: 0;
  text-align: end;
  line-height: 16px;
  color: rgba(255, 255, 255, 0.56);
}
.ih-footer__notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.ih-footer__text {
  margin: 0;
  max-width: 21rem;
  color: rgba(255, 255, 255, 0.66);
}
.ih-footer__actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.ih-footer__ack {
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
.ih-footer__ack-pill {
  display: flex;
  align-items: center;
  min-height: 30px;
  padding-inline: 16px;
  border: 1px solid rgba(255, 255, 255, 0.32);
  border-radius: 999px;
  transition: border-color 150ms ease-out, transform 150ms ease-out;
}
.ih-footer__ack:hover .ih-footer__ack-pill { border-color: rgba(255, 255, 255, 0.6); }
.ih-footer__ack:active .ih-footer__ack-pill { transform: scale(0.97); }

@media (prefers-reduced-motion: reduce) {
  .ih-footer__ack-pill { transition: none; }
  .ih-footer__ack:active .ih-footer__ack-pill { transform: none; }
}
`
