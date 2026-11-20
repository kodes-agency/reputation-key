// Saving a new avatar, called as signed-in members over PostgreSQL with the
// real tenant resolution, execution policy and Better Auth, against the
// in-memory store: the image is stored, the one it replaces is freed, and a
// foreign object is never deleted. The address of an uploaded avatar is saved
// only for the member's own object, and only after its stored size was read.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { getAuth } from '#/shared/auth/auth'
import {
  setupServerFunctionHarness,
  type TestMember,
} from '#/shared/testing/server-function-harness'
import { identityAssetPath } from '../images/identity-assets.contracts'
import { MAX_UPLOAD_BYTES } from '../images/upload-policy.server'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { updateUserImageFn } from './auth-settings'

const harness = setupServerFunctionHarness()

const PNG = Buffer.from('png')

const avatarKey = (member: TestMember) => `avatars/${member.userId}/${randomUUID()}`

async function upload(key: string, body: Buffer = PNG, contentType = 'image/png') {
  await harness.fakes().storage.putObject(key, body, contentType)
}

const stored = (key: string) => harness.fakes().storage.objects().has(key)

async function imageOf(member: TestMember): Promise<string | null> {
  const { rows } = await harness
    .pool()
    .query<{ image: string | null }>(`SELECT image FROM "user" WHERE id = $1`, [
      member.userId,
    ])
  return rows[0]?.image ?? null
}

async function setImage(member: TestMember, image: string | null): Promise<void> {
  await harness
    .pool()
    .query(`UPDATE "user" SET image = $2 WHERE id = $1`, [member.userId, image])
}

const save = (member: TestMember, imageUrl: string | null) =>
  harness.callAs(member, () => updateUserImageFn({ data: { imageUrl } }))

/** An Account Admin whose current avatar is an uploaded object of their own. */
async function memberWithAvatar(
  role: 'AccountAdmin' | 'PropertyManager' = 'AccountAdmin',
) {
  const organization = await harness.seedOrganization()
  const member = await harness.seedMember(organization, role)
  const old = avatarKey(member)
  await upload(old)
  await setImage(member, identityAssetPath(old))
  return { organization, member, old }
}

/** Make Better Auth's own save fail, as a database outage behind it would. */
function failNextAuthSave() {
  vi.spyOn(getAuth().api, 'updateUser').mockRejectedValueOnce(
    Object.assign(new Error('nope'), { statusCode: 500 }),
  )
}

describe('updateUserImageFn', () => {
  it('saves the path an uploaded avatar is stored at, and frees the one it replaces', async () => {
    const { member, old } = await memberWithAvatar()
    const next = avatarKey(member)
    await upload(next)

    await save(member, identityAssetPath(next))

    expect(await imageOf(member)).toBe(identityAssetPath(next))
    expect(stored(old)).toBe(false)
    expect(stored(next)).toBe(true)
  })

  it('lets a Property Manager change their own avatar', async () => {
    const { member, old } = await memberWithAvatar('PropertyManager')
    const next = avatarKey(member)
    await upload(next)

    await save(member, identityAssetPath(next))

    expect(await imageOf(member)).toBe(identityAssetPath(next))
    expect(stored(old)).toBe(false)
  })

  it('keeps the old object when the new image could not be saved', async () => {
    const { member, old } = await memberWithAvatar()
    const next = avatarKey(member)
    await upload(next)
    failNextAuthSave()

    await expect(save(member, identityAssetPath(next))).rejects.toMatchObject({
      name: 'InternalError',
      status: 500,
    })

    expect(await imageOf(member)).toBe(identityAssetPath(old))
    expect(stored(old)).toBe(true)
  })

  // The finalize step reads the stored size, but nothing makes a caller run it:
  // a member could ask for an upload address declaring one byte, send any size
  // and call this function with the path. The save is the step that cannot be
  // skipped, so the size is read here too.
  it('refuses an uploaded avatar the store holds over the cap, removes it, and saves nothing', async () => {
    const { member, old } = await memberWithAvatar()
    const next = avatarKey(member)
    await upload(next, Buffer.alloc(MAX_UPLOAD_BYTES + 1))

    await expect(save(member, identityAssetPath(next))).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'validation_error',
      status: 400,
      message: 'File size exceeds 5 MB limit',
    })

    expect(stored(next)).toBe(false)
    expect(stored(old)).toBe(true)
    expect(await imageOf(member)).toBe(identityAssetPath(old))
  })

  it('refuses an uploaded avatar the store holds as another type, removes it, and saves nothing', async () => {
    const organization = await harness.seedOrganization()
    const member = await harness.seedMember(organization, 'AccountAdmin')
    const next = avatarKey(member)
    await upload(next, Buffer.from('<html>'), 'text/html')

    await expect(save(member, identityAssetPath(next))).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'validation_error',
      status: 400,
      message: 'Content type text/html is not allowed',
    })

    expect(stored(next)).toBe(false)
    expect(await imageOf(member)).toBeNull()
  })

  it('saves nothing when the upload never arrived', async () => {
    const { member, old } = await memberWithAvatar()

    await expect(
      save(member, identityAssetPath(avatarKey(member))),
    ).rejects.toMatchObject({
      name: 'InternalError',
      status: 500,
    })

    expect(await imageOf(member)).toBe(identityAssetPath(old))
    expect(stored(old)).toBe(true)
  })

  // The schema accepts any user's avatar path, and the size check deletes what
  // it refuses, so the key is held to the caller before the store is touched.
  it('refuses another user’s avatar path without reading or deleting their object', async () => {
    const { organization, member } = await memberWithAvatar()
    const other = await harness.seedMember(organization, 'PropertyManager')
    const theirs = avatarKey(other)
    await upload(theirs, Buffer.alloc(MAX_UPLOAD_BYTES + 1))

    await expect(save(member, identityAssetPath(theirs))).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'forbidden',
      status: 403,
    })

    expect(stored(theirs)).toBe(true)
    expect(await imageOf(other)).toBeNull()
  })

  it('never deletes another user’s object, even if that is what was stored', async () => {
    const organization = await harness.seedOrganization()
    const member = await harness.seedMember(organization, 'AccountAdmin')
    const other = await harness.seedMember(organization, 'PropertyManager')
    const theirs = avatarKey(other)
    await upload(theirs)
    await setImage(member, identityAssetPath(theirs))
    const next = avatarKey(member)
    await upload(next)

    await save(member, identityAssetPath(next))

    expect(await imageOf(member)).toBe(identityAssetPath(next))
    expect(stored(theirs)).toBe(true)
  })

  it('still accepts an image hosted elsewhere, and deletes nothing for it', async () => {
    const { member, old } = await memberWithAvatar()

    await save(member, 'https://cdn.example.com/me.png')

    expect(await imageOf(member)).toBe('https://cdn.example.com/me.png')
    expect(stored(old)).toBe(true)
  })

  // Remove is the same call with no image. It used to be refused by the schema,
  // so the page only cleared what it showed and the avatar came back on reload.
  it('removes the avatar: saves no image and frees the object it was', async () => {
    const { member, old } = await memberWithAvatar()

    await save(member, null)

    expect(await imageOf(member)).toBeNull()
    expect(stored(old)).toBe(false)
  })

  it('keeps the object when the removal could not be saved', async () => {
    const { member, old } = await memberWithAvatar()
    failNextAuthSave()

    await expect(save(member, null)).rejects.toMatchObject({
      name: 'InternalError',
      status: 500,
    })

    expect(await imageOf(member)).toBe(identityAssetPath(old))
    expect(stored(old)).toBe(true)
  })

  it('removes an avatar hosted elsewhere without deleting anything', async () => {
    const organization = await harness.seedOrganization()
    const member = await harness.seedMember(organization, 'AccountAdmin')
    const unrelated = avatarKey(member)
    await upload(unrelated)
    await setImage(member, 'https://cdn.example.com/me.png')

    await save(member, null)

    expect(await imageOf(member)).toBeNull()
    expect(stored(unrelated)).toBe(true)
  })

  it('refuses a staff-only login before touching the store', async () => {
    const { organization, old } = await memberWithAvatar()
    const staff = await harness.seedMember(organization, 'Member')
    const next = avatarKey(staff)
    await upload(next, Buffer.alloc(MAX_UPLOAD_BYTES + 1))

    await expect(save(staff, identityAssetPath(next))).rejects.toMatchObject({
      code: 'beta_role_inactive',
    })

    expect(stored(next)).toBe(true)
    expect(stored(old)).toBe(true)
  })
})
