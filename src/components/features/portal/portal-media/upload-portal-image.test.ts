import { describe, expect, it, vi } from 'vitest'
import {
  PORTAL_IMAGE_ACCEPT,
  describePortalImageFile,
  uploadPortalImage,
  validatePortalImageFile,
} from './upload-portal-image'

const file = (type: string, bytes = 4, name = 'terrace.jpg') =>
  new File([new Uint8Array(bytes)], name, { type })

const respond = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const INPUT = {
  propertyId: '11111111-1111-4111-8111-111111111111',
  portalId: '22222222-2222-4222-8222-222222222222',
  purpose: 'link_image',
  rightsConfirmed: true,
} as const

describe('validatePortalImageFile', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (type) => {
    expect(validatePortalImageFile(file(type))).toBeNull()
  })

  it.each(['image/gif', 'image/svg+xml', 'image/heic', 'application/pdf', ''])(
    'refuses %j before anything is sent, and says which formats work',
    (type) => {
      expect(validatePortalImageFile(file(type))).toMatch(/JPEG, PNG or WebP/)
    },
  )

  it('refuses a file over 10 MB by its size', () => {
    const tooBig = file('image/jpeg', 10 * 1024 * 1024 + 1)

    expect(validatePortalImageFile(tooBig)).toMatch(/10 MB/)
    expect(validatePortalImageFile(file('image/jpeg', 10 * 1024 * 1024))).toBeNull()
  })

  it('refuses an empty file', () => {
    expect(validatePortalImageFile(file('image/jpeg', 0))).toMatch(/empty/i)
  })

  it('offers exactly the accepted formats to the file picker', () => {
    expect(PORTAL_IMAGE_ACCEPT).toBe('image/jpeg,image/png,image/webp')
  })
})

describe('describePortalImageFile', () => {
  it('shows the name and a size a person can read', () => {
    expect(
      describePortalImageFile(file('image/jpeg', 3.4 * 1024 * 1024, 'terrace.jpg')),
    ).toBe('terrace.jpg · 3.4 MB')
    expect(describePortalImageFile(file('image/jpeg', 2048, 'a.png'))).toBe(
      'a.png · 2 KB',
    )
  })
})

describe('describePortalImageFile against the limit', () => {
  it('counts megabytes the way the limit does, so a file under 10 MB never reads as 10.4 MB', () => {
    expect(describePortalImageFile(file('image/jpeg', 10_400_000))).toBe(
      'terrace.jpg · 9.9 MB',
    )
    expect(describePortalImageFile(file('image/jpeg', 10 * 1024 * 1024))).toBe(
      'terrace.jpg · 10 MB',
    )
  })
})

describe('uploadPortalImage', () => {
  it('posts the raw bytes to the media endpoint with the purpose, Property and Portal', async () => {
    const send = vi.fn(async () =>
      respond(201, { asset: { assetId: 'asset-1', width: 1200, height: 800 } }),
    )
    const picked = file('image/png', 8)

    const result = await uploadPortalImage(INPUT, picked, send)

    expect(result).toEqual({ ok: true, assetId: 'asset-1' })
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    const parsed = new URL(url, 'http://localhost')
    expect(parsed.pathname).toBe('/api/portal-media')
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      propertyId: INPUT.propertyId,
      portalId: INPUT.portalId,
      purpose: 'link_image',
      rightsConfirmed: 'true',
    })
    expect(init.method).toBe('POST')
    expect(init.body).toBe(picked)
    expect(new Headers(init.headers).get('content-type')).toBe('image/png')
    expect(init.credentials).toBe('same-origin')
  })

  it('does not send anything for a file the policy would refuse', async () => {
    const send = vi.fn()

    const result = await uploadPortalImage(INPUT, file('image/gif'), send)

    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/JPEG/) })
    expect(send).not.toHaveBeenCalled()
  })

  it('does not send anything without the confirmation that the photo may be used', async () => {
    const send = vi.fn()

    const result = await uploadPortalImage(
      { ...INPUT, rightsConfirmed: false },
      file('image/jpeg'),
      send,
    )

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringMatching(/permission/),
    })
    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    [413, 'too_large', /10 MB/],
    [415, 'unsupported_type', /JPEG, PNG or WebP/],
    [415, 'type_mismatch', /isn.t really/],
    [422, 'animated', /still photo/],
    [422, 'too_small', /too small/],
    [422, 'too_many_pixels', /too large/],
    [422, 'extreme_aspect', /too wide or too tall/],
    [422, 'undecodable', /could not read/],
    [422, 'empty', /empty/],
    [422, 'output_too_large', /too detailed/],
    [409, 'asset_limit_reached', /limit/],
    [400, 'rights_not_confirmed', /permission/],
  ])('explains a refused image (%s %s)', async (status, reason, message) => {
    const send = async () => respond(status, { error: 'image_rejected', reason })

    const result = await uploadPortalImage(INPUT, file('image/jpeg'), send)

    expect(result).toMatchObject({ ok: false })
    expect(result.ok ? '' : result.message).toMatch(message)
  })

  it('has a sentence for a refusal it does not know', async () => {
    const send = async () =>
      respond(422, { error: 'image_rejected', reason: 'something_new' })

    const result = await uploadPortalImage(INPUT, file('image/jpeg'), send)

    expect(result.ok ? '' : result.message).toMatch(/could not use that photo/i)
  })

  it.each([
    [403, 'portal_upload_disabled', /not available/],
    [403, 'cross_origin', /not available/],
    [429, 'rate_limited', /too many/i],
    [503, 'rate_limit_unavailable', /try again/i],
    [500, 'internal_error', /try again/i],
    [401, 'unauthenticated', /sign in again/i],
    [404, 'property_not_found', /no longer exists/i],
    [404, 'portal_not_found', /no longer exists/i],
    [403, 'forbidden', /permission/i],
    [403, 'missing_scope', /permission/i],
    [403, 'not_a_member', /permission/i],
    [403, 'capability_disabled', /not available/],
    [403, 'capability_blocked', /not available/],
    [422, 'upload_failed', /try again/i],
  ])('explains a refusal at the edge (%s %s)', async (status, error, message) => {
    const send = async () => respond(status, { error })

    const result = await uploadPortalImage(INPUT, file('image/jpeg'), send)

    expect(result.ok ? '' : result.message).toMatch(message)
  })

  it('does not trust a body it cannot read', async () => {
    const send = async () => new Response('<html>bad gateway</html>', { status: 502 })

    const result = await uploadPortalImage(INPUT, file('image/jpeg'), send)

    expect(result.ok ? '' : result.message).toMatch(/try again/i)
  })

  it('reports an answer that is a success but names no image', async () => {
    const send = async () => respond(201, { asset: {} })

    const result = await uploadPortalImage(INPUT, file('image/jpeg'), send)

    expect(result.ok).toBe(false)
  })

  it('says so when the network is down', async () => {
    const send = async () => {
      throw new TypeError('Failed to fetch')
    }

    const result = await uploadPortalImage(INPUT, file('image/jpeg'), send)

    expect(result.ok ? '' : result.message).toMatch(/connection/i)
  })
})
