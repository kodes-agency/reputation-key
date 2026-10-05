import { describe, expect, it } from 'vitest'
import { updateUserImageInputSchema } from './profile-settings.dto'

const ASSET = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const accepts = (imageUrl: string) =>
  updateUserImageInputSchema.safeParse({ imageUrl }).success

describe('updateUserImageInputSchema', () => {
  // Removing the avatar is saving no image: the same call, with null (UI consistency
  // scan: FORM-14). It used to be refused, so Remove only cleared what the page showed.
  it('accepts null, which removes the avatar', () => {
    expect(updateUserImageInputSchema.safeParse({ imageUrl: null }).success).toBe(true)
  })

  it('still needs the field: no image is an error, not a removal', () => {
    expect(updateUserImageInputSchema.safeParse({}).success).toBe(false)
  })

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
