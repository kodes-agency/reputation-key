// Identity context — update organization use case tests
// Orchestration-level coverage: authorization, validation, and delegation.
// The payload-shape cases (field inclusion + null→undefined) moved to
// organization-update-patch.test.ts.

import { describe, it, expect } from 'vitest'
import { updateOrganization } from './update-organization'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'

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

  it('rejects Staff from updating organization → forbidden', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ name: 'Staff Org' }, ctx)).rejects.toSatisfy(
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

    await useCase({ logo: null }, ctx)

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].logo).toBeUndefined()
  })
})
