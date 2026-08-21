// The sender-alignment warning exists because it is the ONLY signal that
// EMAIL_FROM and the product domain have drifted apart — nothing else in the
// system notices, and the cost (spam foldering) only shows up as volume rises.
//
// Pinned here:
//   1. Misaligned config warns, with both domains named in the text.
//   2. Aligned config — including a sending SUBDOMAIN, which DMARC relaxed
//      alignment accepts — is silent.
//   3. The warn is once per process, not once per message.
//   4. Non-public app hosts (localhost/IP) are silent, so a dev boot is quiet.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appDomainOf,
  checkSenderAlignment,
  resetSenderAlignmentWarning,
  senderDomainOf,
  senderMisalignmentWarning,
  warnOnceOnSenderMisalignment,
} from './sender-alignment'

const APP_URL = 'https://reputationkey.app'
const MISALIGNED_FROM = 'Reputation Key <info@kodes.agency>'
const ALIGNED_FROM = 'Reputation Key <notifications@reputationkey.app>'

beforeEach(() => {
  resetSenderAlignmentWarning()
})

describe('senderDomainOf', () => {
  it('reads the domain out of an RFC 5322 display-name header', () => {
    expect(senderDomainOf(MISALIGNED_FROM)).toBe('kodes.agency')
  })

  it('reads the domain out of a bare addr-spec', () => {
    expect(senderDomainOf('info@kodes.agency')).toBe('kodes.agency')
  })

  it('lowercases and drops a trailing root dot', () => {
    expect(senderDomainOf('Ops <Info@Kodes.Agency.>')).toBe('kodes.agency')
  })

  it('returns null when the header carries no readable domain', () => {
    expect(senderDomainOf('Reputation Key')).toBeNull()
    expect(senderDomainOf('info@')).toBeNull()
    expect(senderDomainOf('@kodes.agency')).toBeNull()
    expect(senderDomainOf('Ops <info@localhost>')).toBeNull()
  })
})

describe('appDomainOf', () => {
  it('is the host of the app URL, without port or path', () => {
    expect(appDomainOf('https://reputationkey.app:8443/dashboard')).toBe(
      'reputationkey.app',
    )
  })

  it('is null when BETTER_AUTH_URL is not an absolute URL', () => {
    expect(appDomainOf('reputationkey.app')).toBeNull()
  })
})

describe('checkSenderAlignment', () => {
  it('flags a sender on an unrelated domain', () => {
    expect(checkSenderAlignment(MISALIGNED_FROM, APP_URL)).toEqual({
      kind: 'misaligned',
      senderDomain: 'kodes.agency',
      appDomain: 'reputationkey.app',
    })
  })

  it('accepts an exact domain match', () => {
    expect(checkSenderAlignment(ALIGNED_FROM, APP_URL)).toEqual({
      kind: 'aligned',
      senderDomain: 'reputationkey.app',
      appDomain: 'reputationkey.app',
    })
  })

  it('accepts a sending subdomain (DMARC relaxed alignment)', () => {
    const alignment = checkSenderAlignment(
      'Reputation Key <notifications@mail.reputationkey.app>',
      APP_URL,
    )
    expect(alignment.kind).toBe('aligned')
  })

  it('accepts the app running on a subdomain of the sending domain', () => {
    const alignment = checkSenderAlignment(ALIGNED_FROM, 'https://app.reputationkey.app')
    expect(alignment.kind).toBe('aligned')
  })

  it.each([
    ['localhost', 'http://localhost:3000'],
    ['an IPv4 literal', 'http://127.0.0.1:3000'],
    ['an IPv6 literal', 'http://[::1]:3000'],
  ])('is indeterminate when the app host is %s', (_label, appUrl) => {
    expect(checkSenderAlignment(MISALIGNED_FROM, appUrl)).toEqual({
      kind: 'indeterminate',
      reason: 'app_host_not_public',
    })
  })

  it('is indeterminate when EMAIL_FROM carries no domain', () => {
    expect(checkSenderAlignment('Reputation Key', APP_URL)).toEqual({
      kind: 'indeterminate',
      reason: 'sender_unparsable',
    })
  })

  it('is indeterminate when BETTER_AUTH_URL is unparsable', () => {
    expect(checkSenderAlignment(MISALIGNED_FROM, 'not-a-url')).toEqual({
      kind: 'indeterminate',
      reason: 'app_url_unparsable',
    })
  })
})

describe('warnOnceOnSenderMisalignment', () => {
  it('warns once, naming both domains and the consequence', () => {
    const warn = vi.fn()

    expect(warnOnceOnSenderMisalignment(MISALIGNED_FROM, APP_URL, warn)).toBe(true)

    expect(warn).toHaveBeenCalledTimes(1)
    const [fields, message] = warn.mock.calls[0]
    expect(fields).toEqual({
      senderDomain: 'kodes.agency',
      appDomain: 'reputationkey.app',
    })
    expect(message).toBe(senderMisalignmentWarning('kodes.agency', 'reputationkey.app'))
    expect(message).toContain('kodes.agency')
    expect(message).toContain('reputationkey.app')
    expect(message).toContain('SPF/DKIM/DMARC')
    expect(message).toContain('EMAIL_FROM')
  })

  it('is a once-per-process latch, not a per-send warning', () => {
    const warn = vi.fn()

    warnOnceOnSenderMisalignment(MISALIGNED_FROM, APP_URL, warn)
    for (let i = 0; i < 50; i++) {
      expect(warnOnceOnSenderMisalignment(MISALIGNED_FROM, APP_URL, warn)).toBe(false)
    }

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('stays silent — and unlatched — when the domains are aligned', () => {
    const warn = vi.fn()

    expect(warnOnceOnSenderMisalignment(ALIGNED_FROM, APP_URL, warn)).toBe(false)
    expect(warn).not.toHaveBeenCalled()

    // Not latched: a later process that IS misconfigured still gets its warn.
    expect(warnOnceOnSenderMisalignment(MISALIGNED_FROM, APP_URL, warn)).toBe(true)
  })
})
