import { describe, expect, it } from 'vitest'
import {
  IDENTITY_ASSET_PUBLIC_PATH,
  identityAssetUrl,
  isIdentityAssetKey,
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

describe('identityAssetUrl', () => {
  it('is an address on the app itself, never on the provider', () => {
    expect(identityAssetUrl('https://app.example.com', `avatars/u1/${ASSET}`)).toBe(
      `https://app.example.com${IDENTITY_ASSET_PUBLIC_PATH}/avatars/u1/${ASSET}`,
    )
  })

  it('does not double the slash of a base URL that ends with one', () => {
    expect(
      identityAssetUrl('https://app.example.com/', `organizations/o1/logo/${ASSET}`),
    ).toBe(
      `https://app.example.com${IDENTITY_ASSET_PUBLIC_PATH}/organizations/o1/logo/${ASSET}`,
    )
  })
})
