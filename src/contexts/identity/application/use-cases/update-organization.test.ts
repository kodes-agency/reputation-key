// Identity context — update organization use case tests
// Orchestration-level coverage: authorization, validation, and delegation.
// The payload-shape cases (field inclusion + null→undefined) moved to
// organization-update-patch.test.ts.

import { describe, it, expect, vi } from 'vitest'
import { updateOrganization } from './update-organization'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import { identityAssetPath } from '../identity-assets'

const OLD = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

// ── Setup ────────────────────────────────────────────────────────

const setup = () => {
  const updateCalls: Array<Record<string, unknown>> = []
  const updateOrg = async (data: Record<string, unknown>) => {
    updateCalls.push(data)
  }

  const deps = { updateOrg }
  const useCase = updateOrganization(deps)

  return { useCase, updateCalls }
}

// ── Tests ────────────────────────────────────────────────────────

describe('updateOrganization', () => {
  it('happy path: AccountAdmin can update organization name and slug', async () => {
    const { useCase, updateCalls } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ name: 'New Org Name', slug: 'new-org-slug' }, ctx)

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]).toEqual({
      name: 'New Org Name',
      slug: 'new-org-slug',
    })
  })

  it('happy path: PropertyManager can update organization', async () => {
    const { useCase, updateCalls } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase({ name: 'PM Org Name' }, ctx)

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].name).toBe('PM Org Name')
  })

  it('rejects Member from updating organization → forbidden', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Member' })

    await expect(useCase({ name: 'Member Org' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects an invalid slug and does not call the auth provider', async () => {
    const { useCase, updateCalls } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(useCase({ slug: 'INVALID SLUG!' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e),
    )
    expect(updateCalls).toHaveLength(0)
  })

  it('delegates the patch-builder payload to the auth provider', async () => {
    const { useCase, updateCalls } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ name: 'Renamed' }, ctx)

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].logo).toBeUndefined()
  })

  // Removing the logo is saving no logo: the provider is told `null`, which is the
  // only value that clears the column (an `undefined` field is skipped).
  it('saves a removed logo as null', async () => {
    const { useCase, updateCalls } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ logo: null }, ctx)

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].logo).toBeNull()
  })
})

describe('updateOrganization removing the logo', () => {
  const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
  const previous = identityAssetPath(`organizations/${ctx.organizationId}/logo/${OLD}`)
  const setupRemoval = (updateOrg = vi.fn().mockResolvedValue(undefined)) => {
    const retireReplaced = vi.fn().mockResolvedValue(undefined)
    const currentLogo = vi.fn().mockResolvedValue(previous)
    const useCase = updateOrganization({ updateOrg, currentLogo, retireReplaced })
    return { useCase, updateOrg, retireReplaced, currentLogo }
  }

  it('frees the stored logo once the removal is saved', async () => {
    const { useCase, retireReplaced } = setupRemoval()

    await useCase({ logo: null }, ctx)

    expect(retireReplaced).toHaveBeenCalledExactlyOnceWith({
      previous,
      nextKey: null,
      kind: 'logo',
      ownerId: ctx.organizationId,
    })
  })

  it('keeps the stored logo when the removal could not be saved', async () => {
    const { useCase, retireReplaced } = setupRemoval(
      vi.fn().mockRejectedValue(new Error('provider down')),
    )

    await expect(useCase({ logo: null }, ctx)).rejects.toThrow('provider down')

    expect(retireReplaced).not.toHaveBeenCalled()
  })

  it('reads and frees nothing for an update that leaves the logo alone', async () => {
    const { useCase, currentLogo, retireReplaced } = setupRemoval()

    await useCase({ name: 'Renamed' }, ctx)

    expect(currentLogo).not.toHaveBeenCalled()
    expect(retireReplaced).not.toHaveBeenCalled()
  })
})
