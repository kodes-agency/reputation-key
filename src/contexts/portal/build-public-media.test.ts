import { expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { buildPortalPublicMedia } from './build-public-media'
it('wires the public and own appearance readers without starting storage I/O', async () => {
  const media = {
    listServableIds: vi.fn(async () => []),
    findForPublicRead: vi.fn(async () => null),
  }
  const store = { getObject: vi.fn() }
  const readers = buildPortalPublicMedia(media, store, {
    clock: () => new Date(),
    logger: { error: vi.fn() },
    decidePublic: async () => ({ allowed: true }),
  })
  expect(
    await readers.mediaUrls(
      organizationId('org'),
      propertyId('11111111-1111-4111-8111-111111111111'),
      [],
    ),
  ).toEqual({})
  expect(readers.serveMedia).toBeTypeOf('function')
  expect(store.getObject).not.toHaveBeenCalled()
})
