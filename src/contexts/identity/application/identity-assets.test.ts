import { describe, expect, it } from 'vitest'
import {
  IDENTITY_ASSET_PUBLIC_PATH,
  identityAssetKeyFromPath,
  identityAssetPath,
  ifNoneMatchMatches,
  isIdentityAssetKey,
  parseIdentityAssetKey,
} from './identity-assets'

const ASSET = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

describe('isIdentityAssetKey', () => {
  it.each([
    `avatars/user_1/${ASSET}`,
    `avatars/Zq0Jm3x9TnV2bK8pLw4rY6cD1eHs7uAf/${ASSET}`,
    `organizations/org-1/logo/${ASSET}`,
  ])('accepts %s', (key) => {
    expect(isIdentityAssetKey(key)).toBe(true)
  })

  it.each([
    '',
    'portal-media/abc.webp',
    `avatars/${ASSET}`,
    `avatars/u/${ASSET}/extra`,
    'avatars/u/../organizations',
    'avatars/../portal-media/abc',
    `avatars/u/${ASSET}.png`,
    `avatars//${ASSET}`,
    `/avatars/u/${ASSET}`,
    `organizations/o/${ASSET}`,
    `organizations/o/logo/${ASSET}/`,
    `avatars/u%2Fv/${ASSET}`,
    'avatars/u/not-a-uuid',
  ])('refuses %j', (key) => {
    expect(isIdentityAssetKey(key)).toBe(false)
  })
})

describe('parseIdentityAssetKey', () => {
  it('names the kind, the owner and the object', () => {
    expect(parseIdentityAssetKey(`avatars/user_1/${ASSET}`)).toEqual({
      kind: 'avatar',
      ownerId: 'user_1',
      objectId: ASSET,
    })
    expect(parseIdentityAssetKey(`organizations/org-1/logo/${ASSET}`)).toEqual({
      kind: 'logo',
      ownerId: 'org-1',
      objectId: ASSET,
    })
  })

  it('names nothing for a key of another shape', () => {
    expect(parseIdentityAssetKey('portal-media/abc.webp')).toBeNull()
  })
})

describe('identityAssetPath', () => {
  it('is a path on the app itself, never an address on the provider or a host', () => {
    expect(identityAssetPath(`avatars/u1/${ASSET}`)).toBe(
      `${IDENTITY_ASSET_PUBLIC_PATH}/avatars/u1/${ASSET}`,
    )
    expect(identityAssetPath(`avatars/u1/${ASSET}`).startsWith('/')).toBe(true)
  })
})

describe('identityAssetKeyFromPath', () => {
  it.each([`avatars/u1/${ASSET}`, `organizations/o1/logo/${ASSET}`])(
    'reads the key back out of the path for %s',
    (key) => {
      expect(identityAssetKeyFromPath(identityAssetPath(key))).toBe(key)
    },
  )

  it.each([
    null,
    '',
    `https://app.example.com${IDENTITY_ASSET_PUBLIC_PATH}/avatars/u1/${ASSET}`,
    `https://bucket.s3.eu-west-1.amazonaws.com/avatars/u1/${ASSET}`,
    `${IDENTITY_ASSET_PUBLIC_PATH}/portal-media/abc.webp`,
    `${IDENTITY_ASSET_PUBLIC_PATH}/avatars/u1/${ASSET}/more`,
  ])('is not one of ours: %j', (address) => {
    expect(identityAssetKeyFromPath(address ?? '')).toBeNull()
  })
})

describe('ifNoneMatchMatches', () => {
  it.each([
    ['"a"', true],
    ['W/"a"', true],
    ['"b", "a"', true],
    ['*', true],
    ['"b"', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('%j against "a" is %s', (header, expected) => {
    expect(ifNoneMatchMatches(header, '"a"')).toBe(expected)
  })
})
