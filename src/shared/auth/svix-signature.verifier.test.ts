import { describe, expect, it } from 'vitest'
import {
  signSvixPayload,
  SVIX_TOLERANCE_SECONDS,
  svixHeaders,
  verifySvixSignature,
} from './svix-signature.verifier'

const SECRET = `whsec_${Buffer.from('resend-webhook-signing-key').toString('base64')}`
const NOW = new Date('2026-08-21T09:00:00Z')
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000))
const ID = 'msg_2abc'
const BODY = '{"type":"email.delivered","data":{"email_id":"prov-1"}}'

const signed = (
  overrides: Partial<{ rawBody: string; id: string; timestamp: string }> = {},
) => {
  const rawBody = overrides.rawBody ?? BODY
  const id = overrides.id ?? ID
  const timestamp = overrides.timestamp ?? TIMESTAMP
  return {
    rawBody,
    signingSecret: SECRET,
    now: NOW,
    headers: {
      id,
      timestamp,
      signature: signSvixPayload({ id, timestamp, rawBody, signingSecret: SECRET }),
    },
  }
}

describe('svix signature verification', () => {
  it('accepts a correctly signed payload', () => {
    expect(verifySvixSignature(signed())).toEqual({ ok: true, id: ID })
  })

  it('rejects a body altered by a single byte', () => {
    const input = signed()

    const result = verifySvixSignature({ ...input, rawBody: `${BODY} ` })

    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('rejects when the signed id does not match the header id', () => {
    const input = signed()

    const result = verifySvixSignature({
      ...input,
      headers: { ...input.headers, id: 'msg_other' },
    })

    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('rejects a replay outside the five-minute window', () => {
    const stale = String(Math.floor(NOW.getTime() / 1000) - SVIX_TOLERANCE_SECONDS - 1)

    const result = verifySvixSignature(signed({ timestamp: stale }))

    expect(result).toEqual({ ok: false, reason: 'timestamp_outside_window' })
  })

  it('accepts a request at the edge of the window', () => {
    const edge = String(Math.floor(NOW.getTime() / 1000) - SVIX_TOLERANCE_SECONDS)

    expect(verifySvixSignature(signed({ timestamp: edge }))).toEqual({
      ok: true,
      id: ID,
    })
  })

  it('rejects a non-numeric timestamp', () => {
    const input = signed()

    const result = verifySvixSignature({
      ...input,
      headers: { ...input.headers, timestamp: 'not-a-number' },
    })

    expect(result).toEqual({ ok: false, reason: 'malformed_timestamp' })
  })

  it('reports missing headers distinctly from a bad signature', () => {
    const input = signed()

    expect(
      verifySvixSignature({ ...input, headers: { ...input.headers, signature: null } }),
    ).toEqual({ ok: false, reason: 'missing_headers' })
  })

  it('accepts when any signature in a rotating set matches', () => {
    const input = signed()
    const rotated = `v1,${Buffer.from('previous-secret-digest').toString('base64')} ${input.headers.signature}`

    expect(
      verifySvixSignature({
        ...input,
        headers: { ...input.headers, signature: rotated },
      }),
    ).toEqual({ ok: true, id: ID })
  })

  it('ignores unknown signature versions', () => {
    const input = signed()

    const result = verifySvixSignature({
      ...input,
      headers: { ...input.headers, signature: 'v2,ZGVhZGJlZWY=' },
    })

    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('rejects a secret whose base64 body is empty', () => {
    const input = signed()

    expect(verifySvixSignature({ ...input, signingSecret: 'whsec_' })).toEqual({
      ok: false,
      reason: 'malformed_secret',
    })
  })

  it('base64-decodes the secret rather than using the raw string', () => {
    const input = signed()

    // Same characters, but not base64-decoded → a different HMAC key.
    const result = verifySvixSignature({
      ...input,
      signingSecret: 'resend-webhook-signing-key',
    })

    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('reads the three Svix headers off a Request', () => {
    const request = new Request('https://app.test/api/webhooks/resend/events', {
      method: 'POST',
      headers: {
        'svix-id': ID,
        'svix-timestamp': TIMESTAMP,
        'svix-signature': 'v1,abc',
      },
    })

    expect(svixHeaders(request)).toEqual({
      id: ID,
      timestamp: TIMESTAMP,
      signature: 'v1,abc',
    })
  })
})
