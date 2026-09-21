import { describe, expect, it } from 'vitest'
import { assertEmailTransportAdmitted, decideEmailTransport } from './transport-selection'

const LIVE_KEY = 're_A1b2C3d4E5f6G7h8I9j0'

describe('email transport selection', () => {
  it('sends when a live key is configured', () => {
    expect(
      decideEmailTransport({ NODE_ENV: 'production', RESEND_API_KEY: LIVE_KEY }),
    ).toEqual({ mode: 'send', reason: 'live_key' })
  })

  it('never reaches a provider under NODE_ENV=test, even with a live key', () => {
    expect(decideEmailTransport({ NODE_ENV: 'test', RESEND_API_KEY: LIVE_KEY })).toEqual({
      mode: 'capture',
      reason: 'test_environment',
    })
  })

  it('outranks an explicit base URL under NODE_ENV=test', () => {
    expect(
      decideEmailTransport({
        NODE_ENV: 'test',
        RESEND_API_KEY: LIVE_KEY,
        RESEND_BASE_URL: 'http://localhost:4101',
      }),
    ).toEqual({ mode: 'capture', reason: 'test_environment' })
  })

  it('captures for the .env.example placeholder instead of failing inside a job', () => {
    // This is the exact string a developer gets from `cp .env.example .env`.
    expect(
      decideEmailTransport({
        NODE_ENV: 'development',
        RESEND_API_KEY: 're_xxxxxxxxxxxx',
      }),
    ).toEqual({ mode: 'capture', reason: 'placeholder_key' })
  })

  it('captures for other obvious non-credentials', () => {
    for (const key of ['', '   ', 'changeme', 're_short', 're_0000000000000000']) {
      expect(
        decideEmailTransport({ NODE_ENV: 'development', RESEND_API_KEY: key }).mode,
      ).toBe('capture')
    }
  })

  it('sends against a stub when an operator set RESEND_BASE_URL, placeholder key and all', () => {
    // The stub does not check credentials; honouring the override is the point
    // of the seam.
    expect(
      decideEmailTransport({
        NODE_ENV: 'development',
        RESEND_API_KEY: 're_xxxxxxxxxxxx',
        RESEND_BASE_URL: 'http://localhost:4101',
      }),
    ).toEqual({ mode: 'send', reason: 'explicit_base_url_override' })
  })

  it('sends with a live key in development — a real key is an explicit choice', () => {
    expect(
      decideEmailTransport({ NODE_ENV: 'development', RESEND_API_KEY: LIVE_KEY }).mode,
    ).toBe('send')
  })
})

describe('production capture refusal', () => {
  // `cp .env.example` in production: capture reports every send as accepted,
  // so the database says mail went out while nothing reached anyone.
  const placeholder = decideEmailTransport({
    NODE_ENV: 'production',
    RESEND_API_KEY: 're_xxxxxxxxxxxx',
  })

  it('refuses a production process that would capture admitted notification mail', () => {
    expect(() =>
      assertEmailTransportAdmitted(placeholder, {
        NODE_ENV: 'production',
        outboundEmailEnabled: true,
      }),
    ).toThrow(/notification email would be captured, not sent/)
  })

  it('lets production capture while outbound email is not enabled', () => {
    expect(() =>
      assertEmailTransportAdmitted(placeholder, {
        NODE_ENV: 'production',
        outboundEmailEnabled: false,
      }),
    ).not.toThrow()
  })

  it('never refuses outside production, or when mail is really sent', () => {
    expect(() =>
      assertEmailTransportAdmitted(placeholder, {
        NODE_ENV: 'development',
        outboundEmailEnabled: true,
      }),
    ).not.toThrow()
    expect(() =>
      assertEmailTransportAdmitted(
        decideEmailTransport({ NODE_ENV: 'production', RESEND_API_KEY: LIVE_KEY }),
        { NODE_ENV: 'production', outboundEmailEnabled: true },
      ),
    ).not.toThrow()
  })
})
