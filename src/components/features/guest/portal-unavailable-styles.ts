// The unavailable page's stylesheet (board G12), hoisted into the head by the
// page. The page has no snapshot, so it has no brand colours: it is the same
// warm paper for every portal and every reason. It is light whatever the app
// theme says (`color-scheme: light` and its own surface, not the app's tokens),
// and a stylesheet rather than utility classes so the arbitrary colours of the
// board stay out of the first-paint CSS of every other page.

export const PORTAL_UNAVAILABLE_STYLE_HREF = 'portal-unavailable'

export const PORTAL_UNAVAILABLE_CSS = `
.portal-unavailable {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 0 36px;
  text-align: center;
  background: radial-gradient(90% 50% at 50% 38%, #fbfaf7 0%, #f6f4f0 60%, #efece6 100%);
  background-color: #f6f4f0;
  color: #2a2723;
  color-scheme: light;
  font-family: var(--font-guest-body, 'Ysabeau Office', system-ui, -apple-system, 'Segoe UI', sans-serif);
  overflow-wrap: break-word;
  word-break: normal;
}
:root:has(.portal-unavailable) { color-scheme: light !important; }
body:has(.portal-unavailable) { background-color: #f6f4f0; }
.portal-unavailable__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 999px;
  background: #ebe7df;
  color: #6b655d;
}
.portal-unavailable__title {
  margin: 22px 0 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 28px;
  text-wrap: balance;
}
.portal-unavailable__body {
  margin: 8px 0 0;
  font-size: 15px;
  line-height: 22px;
  color: #5f5951;
}
.portal-unavailable__retry {
  box-sizing: border-box;
  min-height: 44px;
  margin: 22px 0 0;
  padding: 0 22px;
  border: 1px solid #cdc6ba;
  border-radius: 999px;
  background: transparent;
  color: #2a2723;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 150ms ease-out, transform 150ms ease-out;
}
.portal-unavailable__retry:hover { background: #ebe7df; }
.portal-unavailable__retry:active { transform: scale(0.97); }
.portal-unavailable__retry:focus-visible {
  outline: 2px solid #2a2723;
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .portal-unavailable__retry { transition: none; }
  .portal-unavailable__retry:active { transform: none; }
}
.portal-unavailable__rule {
  width: 40px;
  height: 1px;
  margin: 26px 0;
  background: #d8d2c8;
}
.portal-unavailable__title--secondary {
  margin: 0;
  font-size: 17px;
  line-height: 24px;
}
.portal-unavailable__body--secondary {
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 20px;
}
`
