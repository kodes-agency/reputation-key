import { describe, expect, it, vi } from 'vitest'
import { identityAssetPath } from './identity-assets'
import { retireReplacedIdentityAsset } from './retire-replaced-identity-asset'

const OLD = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const NEW = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

const setup = (deleteObject = vi.fn().mockResolvedValue(undefined)) => {
  const logger = { warn: vi.fn() }
  const retire = retireReplacedIdentityAsset({ storage: { deleteObject }, logger })
  return { retire, deleteObject, logger }
}

describe('retireReplacedIdentityAsset', () => {
  it('deletes the object the owner had before', async () => {
    const { retire, deleteObject } = setup()

    await retire({
      previous: identityAssetPath(`avatars/u1/${OLD}`),
      nextKey: `avatars/u1/${NEW}`,
      kind: 'avatar',
      ownerId: 'u1',
    })

    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(`avatars/u1/${OLD}`)
  })

  it('deletes a replaced logo', async () => {
    const { retire, deleteObject } = setup()

    await retire({
      previous: identityAssetPath(`organizations/o1/logo/${OLD}`),
      nextKey: `organizations/o1/logo/${NEW}`,
      kind: 'logo',
      ownerId: 'o1',
    })

    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(`organizations/o1/logo/${OLD}`)
  })

  it.each([
    ['nothing before', null],
    ['a picture hosted elsewhere', 'https://cdn.example.com/me.png'],
    [
      'an address on a provider',
      `https://b.s3.eu-west-1.amazonaws.com/avatars/u1/${OLD}`,
    ],
    ['the same object', identityAssetPath(`avatars/u1/${NEW}`)],
    ['another user’s avatar', identityAssetPath(`avatars/u2/${OLD}`)],
    [
      'a logo where an avatar is replaced',
      identityAssetPath(`organizations/u1/logo/${OLD}`),
    ],
  ])('deletes nothing when there was %s', async (_label, previous) => {
    const { retire, deleteObject } = setup()

    await retire({
      previous,
      nextKey: `avatars/u1/${NEW}`,
      kind: 'avatar',
      ownerId: 'u1',
    })

    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('logs and carries on when the store refuses the delete', async () => {
    const { retire, logger } = setup(vi.fn().mockRejectedValue(new Error('503')))

    await expect(
      retire({
        previous: identityAssetPath(`avatars/u1/${OLD}`),
        nextKey: `avatars/u1/${NEW}`,
        kind: 'avatar',
        ownerId: 'u1',
      }),
    ).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledOnce()
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(OLD)
  })
})
