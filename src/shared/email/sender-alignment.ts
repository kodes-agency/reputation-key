// Sender-domain alignment check for outbound mail.
//
// SPF, DKIM and DMARC authenticate the domain the message is SENT AS, not the
// brand the reader sees. `EMAIL_FROM` defaults to a `kodes.agency` sender while
// the product lives on `reputationkey.app`, so every outbound message is
// unaligned with the product domain: receivers see a From: domain with no
// relationship to the links in the body, which costs inbox placement and reads
// as a phishing tell. The cost scales with volume, so it stays cheap right up
// until it is expensive.
//
// This module does NOT change the sender — flipping the default before
// reputationkey.app is verified in Resend would break sending outright. It
// makes the misconfiguration LOUD exactly once per process.
//
// Deliberately pure (no env, no logger, no SDK) like the rest of shared/email:
// the caller supplies both strings and the warn sink, so both branches are
// assertable without touching process state.

/** Outcome of comparing the sender domain with the app's own host. */
export type SenderAlignment =
  | Readonly<{ kind: 'aligned'; senderDomain: string; appDomain: string }>
  | Readonly<{ kind: 'misaligned'; senderDomain: string; appDomain: string }>
  | Readonly<{
      kind: 'indeterminate'
      reason: 'sender_unparsable' | 'app_url_unparsable' | 'app_host_not_public'
    }>

/** Fields attached to the warn. Domains only — never an address (BQC-7.3). */
export type SenderAlignmentFields = Readonly<{
  senderDomain: string
  appDomain: string
}>

export type WarnSink = (fields: SenderAlignmentFields, message: string) => void

const ANGLE_ADDRESS = /<([^<>]*)>\s*$/

// Both of these were single regexes with a quantifier nested inside another
// (`(\.[a-z0-9-]+)+`, `(\.\d{1,3}){3}`). That shape backtracks super-linearly
// and `security/detect-unsafe-regex` rejects it. Splitting on '.' and matching
// each label with a flat pattern is linear, and reads better besides.
const LABEL = /^[a-z0-9-]+$/
const OCTET = /^\d{1,3}$/

/** A dotted hostname of two or more labels, e.g. `mail.example.com`. */
const isDomainName = (value: string): boolean => {
  const labels = value.split('.')
  return labels.length >= 2 && labels.every((label) => LABEL.test(label))
}

/** A bare IPv4 literal. Used only to keep dev hosts out of the warn. */
const isIpv4 = (value: string): boolean => {
  const octets = value.split('.')
  return octets.length === 4 && octets.every((octet) => OCTET.test(octet))
}

/**
 * The domain of an RFC 5322 From header — `Name <local@domain>` or a bare
 * `local@domain`. Returns null when the header is not a single addr-spec we
 * can read a domain out of (the env schema only enforces `min(3)`).
 */
export const senderDomainOf = (from: string): string | null => {
  const trimmed = from.trim()
  const angled = ANGLE_ADDRESS.exec(trimmed)
  const address = (angled ? angled[1] : trimmed).trim()
  const at = address.lastIndexOf('@')
  if (at <= 0 || at === address.length - 1) return null
  const domain = address
    .slice(at + 1)
    .trim()
    .replace(/\.$/, '')
    .toLowerCase()
  return isDomainName(domain) ? domain : null
}

/** The host of an absolute app URL (`BETTER_AUTH_URL`), or null if unparsable. */
export const appDomainOf = (appUrl: string): string | null => {
  try {
    const host = new URL(appUrl).hostname.toLowerCase().replace(/\.$/, '')
    return host === '' ? null : host
  } catch {
    return null
  }
}

/**
 * Compare the sender domain with the app host.
 *
 * A subdomain counts as ALIGNED: DMARC relaxed alignment (the default policy)
 * matches on the organizational domain, so `notifications@mail.example.app`
 * sending for `example.app` is correctly configured and must not warn.
 */
export const checkSenderAlignment = (from: string, appUrl: string): SenderAlignment => {
  const senderDomain = senderDomainOf(from)
  if (senderDomain === null) return { kind: 'indeterminate', reason: 'sender_unparsable' }

  const appDomain = appDomainOf(appUrl)
  if (appDomain === null) return { kind: 'indeterminate', reason: 'app_url_unparsable' }
  // DMARC alignment is only a meaningful question for a PUBLIC host.
  // `localhost`, an IP literal or a bracketed IPv6 host is a developer or CI
  // deployment where nothing receives mail "from" the app, so comparing there
  // would only produce noise on every local boot.
  const appHostIsPublic =
    appDomain.includes('.') &&
    !isIpv4(appDomain) &&
    appDomain !== 'localhost' &&
    !appDomain.endsWith('.localhost')
  if (!appHostIsPublic) return { kind: 'indeterminate', reason: 'app_host_not_public' }

  const aligned =
    senderDomain === appDomain ||
    senderDomain.endsWith(`.${appDomain}`) ||
    appDomain.endsWith(`.${senderDomain}`)

  return { kind: aligned ? 'aligned' : 'misaligned', senderDomain, appDomain }
}

/** The warn text. Exported so the test asserts the operator-facing wording. */
export const senderMisalignmentWarning = (
  senderDomain: string,
  appDomain: string,
): string =>
  `Email sender domain "${senderDomain}" is not aligned with app domain "${appDomain}" (BETTER_AUTH_URL). ` +
  `SPF/DKIM/DMARC authenticate the sending domain, so mail sent as "${senderDomain}" from a "${appDomain}" ` +
  `product will increasingly be filtered as spam or spoofing as volume rises. ` +
  `Fix: verify "${appDomain}" in Resend and point EMAIL_FROM at a sender on that domain.`

// Process-wide latch. The condition is a static property of the DEPLOYMENT, so
// re-stating it per message would be pure log spam on the highest-volume path
// in the system — exactly the path this warning is about.
let warned = false

/**
 * Warn at most once per process that the sender and product domains diverge.
 *
 * Returns whether this call emitted the warn, so the latch is assertable.
 */
export const warnOnceOnSenderMisalignment = (
  from: string,
  appUrl: string,
  warn: WarnSink,
): boolean => {
  if (warned) return false
  const alignment = checkSenderAlignment(from, appUrl)
  if (alignment.kind !== 'misaligned') return false
  warned = true
  const { senderDomain, appDomain } = alignment
  warn({ senderDomain, appDomain }, senderMisalignmentWarning(senderDomain, appDomain))
  return true
}

/** Clear the once-per-process latch. Test seam only. */
export const resetSenderAlignmentWarning = (): void => {
  warned = false
}
