// Which outbound-email transport a boot should use.
//
// `bootstrap.ts` used to construct the real Resend adapter unconditionally.
// `RESEND_API_KEY` is REQUIRED by the env schema (`z.string().min(1)`), so a
// developer copying `.env.example` gets the literal placeholder
// `re_xxxxxxxxxxxx`, boot succeeds, and the first notification email fails deep
// inside a BullMQ job with a provider auth error. Worse, a real key left in a
// local `.env` mails real inboxes from a laptop.
//
// So the decision is made once, explicitly, at wiring time — and logged loudly,
// because "email silently went nowhere" is the single most expensive thing for
// this subsystem to be ambiguous about.
//
// Note this is orthogonal to RESEND_BASE_URL: that seam points the REAL client
// at a mail stub (an integration concern), whereas `capture` never constructs a
// client at all (a local-development concern).

export type EmailTransportMode = 'send' | 'capture'

export type EmailTransportDecision = Readonly<{
  mode: EmailTransportMode
  /** Why, for the boot log. Safe to print — never contains the key. */
  reason:
    | 'live_key'
    | 'test_environment'
    | 'placeholder_key'
    | 'explicit_base_url_override'
}>

/**
 * A key that is obviously not a credential. Resend keys are `re_` followed by a
 * long random tail; the `.env.example` placeholder and the usual hand-typed
 * stand-ins are not.
 */
function isPlaceholderKey(key: string): boolean {
  const trimmed = key.trim()
  if (!trimmed.startsWith('re_')) return true
  const tail = trimmed.slice('re_'.length)
  return tail.length < 16 || /^x+$/i.test(tail) || /^0+$/.test(tail)
}

export function decideEmailTransport(
  env: Readonly<{
    NODE_ENV: string
    RESEND_API_KEY: string
    RESEND_BASE_URL?: string | undefined
  }>,
): EmailTransportDecision {
  // A test run must never reach a provider, even with a valid key in the
  // environment. This is the one rule that outranks an explicit base URL.
  if (env.NODE_ENV === 'test') return { mode: 'capture', reason: 'test_environment' }

  // An operator who pointed RESEND_BASE_URL at a stub asked for the real client
  // against that stub — honour it even if the key is a placeholder, because the
  // stub does not check credentials.
  if (env.RESEND_BASE_URL) {
    return { mode: 'send', reason: 'explicit_base_url_override' }
  }

  return isPlaceholderKey(env.RESEND_API_KEY)
    ? { mode: 'capture', reason: 'placeholder_key' }
    : { mode: 'send', reason: 'live_key' }
}
