// The route file is wiring only: its splat is the object key, and the request
// itself reaches the handler (for If-None-Match).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ handle: vi.fn() }))

vi.mock('#/contexts/identity/server/identity-asset-serve', () => ({
  handleIdentityAssetServe: mocks.handle,
}))

import { Route } from './$'

const ASSET = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

type GetHandler = (context: {
  request: Request
  params: { _splat?: string }
}) => Promise<Response>

const get = (Route.options as unknown as { server: { handlers: { GET: GetHandler } } })
  .server.handlers.GET

describe('GET /api/public/identity-assets/$', () => {
  beforeEach(() => {
    mocks.handle.mockReset()
    mocks.handle.mockResolvedValue(new Response('ok'))
  })

  it('hands the request and the splat key to the handler', async () => {
    const request = new Request(
      `https://app.example.test/api/public/identity-assets/avatars/u1/${ASSET}`,
      { headers: { 'if-none-match': '"x"' } },
    )

    const response = await get({ request, params: { _splat: `avatars/u1/${ASSET}` } })

    expect(await response.text()).toBe('ok')
    expect(mocks.handle).toHaveBeenCalledExactlyOnceWith(request, `avatars/u1/${ASSET}`)
  })

  it('hands an empty key, which the handler refuses, when there is no splat', async () => {
    const request = new Request('https://app.example.test/api/public/identity-assets/')

    await get({ request, params: {} })

    expect(mocks.handle).toHaveBeenCalledExactlyOnceWith(request, '')
  })
})
