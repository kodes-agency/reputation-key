// updateOrganization, called as signed-in members over PostgreSQL with the real
// tenant resolution, execution policy, use case and Better Auth provider.

import { describe, expect, it, vi } from 'vitest'
import {
  createInMemoryStorage,
  setupServerFunctionHarness,
  type TestOrganization,
} from '#/shared/testing/server-function-harness'
import { identityAssetPath } from '../images/identity-assets.contracts'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { updateOrganization } from './organizations.update'

const storage = createInMemoryStorage()
const harness = setupServerFunctionHarness({ providers: { storage } })

const LOGO_ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

type Row = {
  name: string
  slug: string
  logo: string | null
  contactEmail: string | null
}

async function organizationRow(organization: TestOrganization): Promise<Row> {
  const { rows } = await harness
    .pool()
    .query<Row>(
      `SELECT name, slug, logo, "contactEmail" FROM organization WHERE id = $1`,
      [organization.id],
    )
  return rows[0]!
}

async function givenLogo(organization: TestOrganization, ownerId = organization.id) {
  const key = `organizations/${ownerId}/logo/${LOGO_ID}`
  await storage.putObject(key, Buffer.from('logo'), 'image/png')
  await harness
    .pool()
    .query(`UPDATE organization SET logo = $2 WHERE id = $1`, [
      organization.id,
      identityAssetPath(key),
    ])
  return key
}

const hasObject = async (key: string) => (await storage.getObject(key, 1024)) !== null

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  return { organization, admin }
}

describe('updateOrganization', () => {
  it('renames the Organization for its AccountAdmin', async () => {
    const { organization, admin } = await hotel()

    await harness.callAs(admin, () =>
      updateOrganization({ data: { name: 'Harborline' } }),
    )

    expect(await organizationRow(organization)).toMatchObject({ name: 'Harborline' })
  })

  it('refuses a PropertyManager and changes nothing', async () => {
    const { organization } = await hotel()
    const manager = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(manager, () => updateOrganization({ data: { name: 'Taken over' } })),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })

    expect(await organizationRow(organization)).toMatchObject({ name: 'Harness Hotels' })
  })

  it('refuses a staff-only login and a caller with no session', async () => {
    const { organization } = await hotel()
    const staff = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(staff, () => updateOrganization({ data: { name: 'Nope' } })),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    await expect(
      harness.callAs(null, () => updateOrganization({ data: { name: 'Nope' } })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })

    expect(await organizationRow(organization)).toMatchObject({ name: 'Harness Hotels' })
  })

  it("changes only the caller's own Organization", async () => {
    const { organization, admin } = await hotel()
    const other = await harness.seedOrganization()

    await harness.callAs(admin, () =>
      updateOrganization({ data: { name: 'Harborline' } }),
    )

    expect(await organizationRow(other)).toMatchObject({ name: 'Harness Hotels' })
    expect(await organizationRow(organization)).toMatchObject({ name: 'Harborline' })
  })

  it('refuses an invalid slug before anything is saved', async () => {
    const { organization, admin } = await hotel()
    const before = await organizationRow(organization)

    await expect(
      harness.callAs(admin, () => updateOrganization({ data: { slug: 'Not A Slug!' } })),
    ).rejects.toMatchObject({ status: 400 })

    expect(await organizationRow(organization)).toEqual(before)
  })

  it('refuses a malformed contact email and input the schema does not allow, saving nothing', async () => {
    const { organization, admin } = await hotel()
    await harness
      .pool()
      .query(
        `UPDATE organization SET "contactEmail" = 'ops@harborline.example' WHERE id = $1`,
        [organization.id],
      )
    const before = await organizationRow(organization)

    await expect(
      harness.callAs(admin, () =>
        updateOrganization({ data: { contactEmail: 'not-an-email' } }),
      ),
    ).rejects.toThrow(/invalid email/iu)
    expect(await organizationRow(organization)).toEqual(before)
    await expect(
      harness.callAs(admin, () =>
        updateOrganization({ data: { name: 'x', id: 'other' } as never }),
      ),
    ).rejects.toThrow(/unrecognized/i)
    expect(await organizationRow(organization)).toEqual(before)
  })

  it('refuses a logo address that an upload has to save', async () => {
    const { organization, admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        updateOrganization({
          data: {
            logo: identityAssetPath(`organizations/${organization.id}/logo/${LOGO_ID}`),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_error', status: 400 })

    expect((await organizationRow(organization)).logo).toBeNull()
  })
})

describe('updateOrganization removing the logo', () => {
  it('saves the logo as removed and frees the object it was', async () => {
    const { organization, admin } = await hotel()
    const key = await givenLogo(organization)

    await harness.callAs(admin, () => updateOrganization({ data: { logo: null } }))

    expect((await organizationRow(organization)).logo).toBeNull()
    expect(await hasObject(key)).toBe(false)
  })

  it('keeps the object when the removal could not be saved', async () => {
    const { organization, admin } = await hotel()
    const key = await givenLogo(organization)
    const taken = await harness.seedOrganization()

    await expect(
      harness.callAs(admin, () =>
        updateOrganization({
          data: { logo: null, slug: `h-${taken.id.replace(/-/g, '')}` },
        }),
      ),
    ).rejects.toMatchObject({ status: 400 })

    expect((await organizationRow(organization)).logo).toBe(identityAssetPath(key))
    expect(await hasObject(key)).toBe(true)
  })

  it("never deletes another Organization's object, even if the stored address points at it", async () => {
    const { organization, admin } = await hotel()
    const other = await harness.seedOrganization()
    const foreignKey = `organizations/${other.id}/logo/${LOGO_ID}`
    await storage.putObject(foreignKey, Buffer.from('theirs'), 'image/png')
    await givenLogo(organization, other.id)

    await harness.callAs(admin, () => updateOrganization({ data: { logo: null } }))

    expect((await organizationRow(organization)).logo).toBeNull()
    expect(await hasObject(foreignKey)).toBe(true)
  })

  it('leaves the logo and the store alone for an update that does not mention it', async () => {
    const { organization, admin } = await hotel()
    const key = await givenLogo(organization)

    await harness.callAs(admin, () => updateOrganization({ data: { name: 'Renamed' } }))

    expect(await organizationRow(organization)).toMatchObject({
      name: 'Renamed',
      logo: identityAssetPath(key),
    })
    expect(await hasObject(key)).toBe(true)
  })

  it("does not let another Organization's AccountAdmin remove this logo", async () => {
    const { organization } = await hotel()
    const key = await givenLogo(organization)
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'AccountAdmin')

    await harness.callAs(stranger, () => updateOrganization({ data: { logo: null } }))

    expect((await organizationRow(organization)).logo).toBe(identityAssetPath(key))
    expect(await hasObject(key)).toBe(true)
  })
})

describe('updateOrganization contact email', () => {
  it('clears the address for the empty string a cleared field sends', async () => {
    const { organization, admin } = await hotel()
    await harness
      .pool()
      .query(`UPDATE organization SET "contactEmail" = 'ops@old.example' WHERE id = $1`, [
        organization.id,
      ])

    await harness.callAs(admin, () =>
      updateOrganization({ data: { name: 'Harborline', contactEmail: '' } }),
    )

    expect(await organizationRow(organization)).toMatchObject({
      name: 'Harborline',
      contactEmail: null,
    })
  })

  it('clears the address for an explicit null', async () => {
    const { organization, admin } = await hotel()
    await harness
      .pool()
      .query(`UPDATE organization SET "contactEmail" = 'ops@old.example' WHERE id = $1`, [
        organization.id,
      ])

    await harness.callAs(admin, () =>
      updateOrganization({ data: { contactEmail: null } }),
    )

    expect((await organizationRow(organization)).contactEmail).toBeNull()
  })

  it('saves an address as it was typed', async () => {
    const { organization, admin } = await hotel()

    await harness.callAs(admin, () =>
      updateOrganization({ data: { contactEmail: 'ops@harborline.example' } }),
    )

    expect((await organizationRow(organization)).contactEmail).toBe(
      'ops@harborline.example',
    )
  })

  it('leaves the address alone for an update that does not mention it', async () => {
    const { organization, admin } = await hotel()
    await harness
      .pool()
      .query(`UPDATE organization SET "contactEmail" = 'ops@old.example' WHERE id = $1`, [
        organization.id,
      ])

    await harness.callAs(admin, () => updateOrganization({ data: { name: 'Renamed' } }))

    expect(await organizationRow(organization)).toMatchObject({
      name: 'Renamed',
      contactEmail: 'ops@old.example',
    })
  })

  it('does not touch the logo or the store: only a removed logo frees an object', async () => {
    const { organization, admin } = await hotel()
    const key = await givenLogo(organization)

    await harness.callAs(admin, () => updateOrganization({ data: { contactEmail: '' } }))

    expect((await organizationRow(organization)).logo).toBe(identityAssetPath(key))
    expect(await hasObject(key)).toBe(true)
  })
})
