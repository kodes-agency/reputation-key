import { describe, expect, it } from 'vitest'
import { updateUserImageInputSchema } from './profile-settings.dto'

const ASSET = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const accepts = (imageUrl: string) =>
  updateUserImageInputSchema.safeParse({ imageUrl }).success

describe('updateUserImageInputSchema', () => {
  it.each([
    'https://cdn.example.com/me.png',
    `/api/public/identity-assets/avatars/user-1/${ASSET}`,
  ])('accepts %s', (imageUrl) => {
    expect(accepts(imageUrl)).toBe(true)
  })

  it.each([
    '',
    '/etc/passwd',
    'me.png',
    // An organization logo is not an avatar.
    `/api/public/identity-assets/organizations/org-1/logo/${ASSET}`,
    `/api/public/identity-assets/avatars/user-1/${ASSET}/more`,
    '/api/public/portal-media/abc',
  ])('refuses %j', (imageUrl) => {
    expect(accepts(imageUrl)).toBe(false)
  })
})
