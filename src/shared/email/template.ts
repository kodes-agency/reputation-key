// Shared email HTML shell — used by all email templates across contexts.
// Extracted from shared/auth/emails.ts so notification and other contexts
// can build HTML emails without importing auth internals.

/** Escape user-controlled values before embedding in HTML email templates.
 * Prevents XSS via HTML entity encoding. */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Wrap body/footer HTML in the standard Reputation Key email shell. */
export function emailShell(bodyHtml: string, footerHtml: string = ''): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 480px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #4fb8b2, #2f6a4a); padding: 32px 24px; text-align: center; }
    .header h1 { color: #fff; margin: 0; font-size: 20px; font-weight: 600; }
    .body { padding: 32px 24px; }
    .body p { color: #333; font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
    .button { display: inline-block; background: #4fb8b2; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 8px 0 24px; }
    .footer { padding: 16px 24px; text-align: center; color: #999; font-size: 13px; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Reputation Key</h1>
    </div>
    <div class="body">${bodyHtml}</div>
    ${footerHtml ? `<div class="footer">${footerHtml}</div>` : ''}
  </div>
</body>
</html>`
}
