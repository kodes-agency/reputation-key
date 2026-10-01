// Portal context — what the New portal dialog needs to know about a Property.

import { describe, expect, it } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import {
  CREATOR,
  OTHER_PROPERTY,
  PROPERTY,
  setupCreatePortal,
  type CreatePortalSetupOptions,
} from '#/shared/testing/portal-create-setup'
import { getPortalCreationOptions } from './get-portal-creation-options'

const ctx = buildTestAuthContext({ role: 'PropertyManager' })

function optionsFor(options: CreatePortalSetupOptions = {}) {
  const setup = setupCreatePortal(options)
  return { setup, run: getPortalCreationOptions(setup.optionsDeps) }
}

describe('getPortalCreationOptions', () => {
  it('offers the Property default languages, first as primary', async () => {
    const { run } = optionsFor({ propertyDefaults: ['bg', 'en'] })
    const result = await run({ propertyId: String(PROPERTY) }, ctx)
    expect(result.defaultGuestLocales).toEqual(['bg', 'en'])
  })

  it('falls back to English when the Property has no default', async () => {
    const { run } = optionsFor()
    expect(
      (await run({ propertyId: String(PROPERTY) }, ctx)).defaultGuestLocales,
    ).toEqual(['en'])
  })

  it('never offers a language nobody may use yet', async () => {
    const { run } = optionsFor({ propertyDefaults: ['de', 'bg'] })
    expect(
      (await run({ propertyId: String(PROPERTY) }, ctx)).defaultGuestLocales,
    ).toEqual(['bg'])
  })

  it('lists the managers eligible for the Property and says whether the caller is one', async () => {
    const { run } = optionsFor({
      managers: [
        { userId: CREATOR, role: 'PropertyManager' },
        { userId: 'user-admin', role: 'AccountAdmin' },
      ],
    })
    const result = await run({ propertyId: String(PROPERTY) }, ctx)
    expect(result.eligibleManagerUserIds).toEqual([CREATOR, 'user-admin'])
    expect(result.creatorIsEligible).toBe(true)
  })

  it('says so when the caller is not an eligible manager', async () => {
    const { run } = optionsFor({
      managers: [{ userId: 'user-admin', role: 'AccountAdmin' }],
    })
    expect((await run({ propertyId: String(PROPERTY) }, ctx)).creatorIsEligible).toBe(
      false,
    )
  })

  it('refuses a role that cannot create portals', async () => {
    const { run } = optionsFor()
    await expect(
      run({ propertyId: String(PROPERTY) }, buildTestAuthContext({ role: 'Member' })),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'forbidden')
  })

  it('refuses a Property the caller is not assigned to', async () => {
    const { run } = optionsFor({ accessible: [OTHER_PROPERTY] })
    await expect(run({ propertyId: String(PROPERTY) }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'forbidden',
    )
  })

  it('refuses a Property that does not exist', async () => {
    const { run } = optionsFor()
    await expect(run({ propertyId: 'nonexistent' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'property_not_found',
    )
  })
})
