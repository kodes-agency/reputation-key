// The browser side of the List-Unsubscribe URL.
//
// A mail client without one-click support, or a person who copies the header
// URL, opens `/api/notifications/unsubscribe?token=…` with a GET — and so do
// link scanners, which is why a GET never unsubscribes. It only offers a form
// that POSTs back to the same URL marked `source=page`, so the answer is a page
// the person can read rather than RFC 8058's empty 204 (a browser shows a 204
// as nothing happening).
//
// The page never checks the token and reads nothing: it is the same for every
// token, so it cannot tell anyone whether a link is valid or its rows retained.

import { EMAIL_PALETTE } from '#/shared/email'
import { ONE_CLICK_UNSUBSCRIBE_PATH } from '../application/one-click-unsubscribe-token'

/** What an unsubscribe POST came to, whichever way it was sent. */
export type OneClickOutcome = 'accepted' | 'invalid_request' | 'disabled' | 'failed'

const PAGE_SOURCE_PARAM = 'source'
const PAGE_SOURCE = 'page'

/** The page every notification email's footer links to (`PREFERENCES_PATH`). */
const PREFERENCES_PATH = '/settings/notifications'

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  // The token rides in this page's URL; it must not follow any link out.
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex',
} as const

type PageContent = Readonly<{
  heading: string
  message: string
  /** Label of the button that POSTs the one-click form; no form when absent. */
  confirm?: string
}>

const LANDING: PageContent = {
  heading: 'Unsubscribe from these emails?',
  message:
    'You will stop getting email for the notifications this message was about. ' +
    'They stay in Reputation Key, and account notices are not affected.',
  confirm: 'Unsubscribe',
}

const OUTCOME_PAGES: Readonly<
  Record<OneClickOutcome, Readonly<{ status: number; content: PageContent }>>
> = {
  // Identical for a stale token, like the 204 it stands in for.
  accepted: {
    status: 200,
    content: {
      heading: 'Unsubscribe request received',
      message:
        'Unless this link has expired, email for these notifications is now off. ' +
        'You can change that at any time in your notification preferences.',
    },
  },
  invalid_request: {
    status: 400,
    content: {
      heading: 'This request could not be read',
      message:
        'Open the link from the email again, or turn these emails off in your ' +
        'notification preferences.',
    },
  },
  disabled: {
    status: 503,
    content: {
      heading: 'Unsubscribe links are unavailable',
      message: 'You can turn these emails off in your notification preferences.',
    },
  },
  failed: {
    status: 500,
    content: {
      heading: 'Your preferences were not changed',
      message: 'Something went wrong on our side. Please try again.',
      confirm: 'Try again',
    },
  },
}

const { light, dark } = EMAIL_PALETTE

// Inline, because the page is one response with no assets; the CSP admits
// inline styles and a same-origin form action, and nothing here runs script.
const PAGE_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
  background: ${light.page}; color: ${light.textPrimary};
  font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
main {
  width: 100%; max-width: 440px; padding: 32px;
  background: ${light.surface}; border: 1px solid ${light.border}; border-radius: 12px;
}
.wordmark { margin: 0 0 28px; font-size: 14px; font-weight: 700; letter-spacing: 0.01em; color: ${light.accent}; }
h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.3; }
.message { margin: 0 0 24px; }
form { margin: 0 0 24px; }
button {
  font: inherit; font-weight: 600; padding: 10px 20px; border: 0; border-radius: 6px; cursor: pointer;
  background: ${light.accent}; color: ${light.accentForeground};
}
button:hover { filter: brightness(1.12); }
button:active { filter: brightness(0.94); }
a { color: ${light.accent}; text-underline-offset: 2px; }
button:focus-visible, a:focus-visible { outline: 2px solid ${light.accent}; outline-offset: 3px; }
.secondary { margin: 0; padding-top: 16px; border-top: 1px solid ${light.border}; font-size: 14px; color: ${light.textSecondary}; }
@media (prefers-color-scheme: dark) {
  body { background: ${dark.page}; color: ${dark.textPrimary}; }
  main { background: ${dark.surface}; border-color: ${dark.border}; }
  .wordmark, a { color: ${dark.accent}; }
  button { background: ${dark.accent}; color: ${dark.accentForeground}; }
  button:focus-visible, a:focus-visible { outline-color: ${dark.accent}; }
  .secondary { color: ${dark.textSecondary}; border-color: ${dark.border}; }
}
`

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!)

/** The same token, back to the same endpoint, marked as the page's own form. */
function confirmAction(request: Request): string {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  const search = new URLSearchParams({ token, [PAGE_SOURCE_PARAM]: PAGE_SOURCE })
  return `${ONE_CLICK_UNSUBSCRIBE_PATH}?${search.toString()}`
}

function renderPage(content: PageContent, action: string): string {
  const form =
    content.confirm === undefined
      ? ''
      : `<form method="post" action="${escapeHtml(action)}">` +
        '<input type="hidden" name="List-Unsubscribe" value="One-Click">' +
        `<button type="submit">${escapeHtml(content.confirm)}</button></form>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(content.heading)} · Reputation Key</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
<p class="wordmark">Reputation Key</p>
<h1>${escapeHtml(content.heading)}</h1>
<p class="message">${escapeHtml(content.message)}</p>
${form}
<p class="secondary"><a href="${PREFERENCES_PATH}">Manage notification preferences</a></p>
</main>
</body>
</html>`
}

/** True for a POST from the landing page's form, which a browser submits. */
export function isLandingPageConfirmation(request: Request): boolean {
  return new URL(request.url).searchParams.get(PAGE_SOURCE_PARAM) === PAGE_SOURCE
}

/** GET: offer the confirm form. Never unsubscribes; never reads the token. */
export function unsubscribeLandingPage(request: Request): Response {
  return new Response(renderPage(LANDING, confirmAction(request)), {
    status: 200,
    headers: PAGE_HEADERS,
  })
}

/** The page a browser sees after submitting the landing page's form. */
export function unsubscribeOutcomePage(
  outcome: OneClickOutcome,
  request: Request,
): Response {
  const page = OUTCOME_PAGES[outcome]
  return new Response(renderPage(page.content, confirmAction(request)), {
    status: page.status,
    headers: PAGE_HEADERS,
  })
}
