// Identity context — update organization use case tests

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

  it('converts null logo to undefined for Better Auth', async () => {
    const { useCase, updateCalls } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ logo: null }, ctx)

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].logo).toBeUndefined()
  })

  it('passes logo value when provided', async () => {
    const { useCase, updateCalls } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ logo: 'https://example.com/logo.png' }, ctx)

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].logo).toBe('https://example.com/logo.png')
  })

  it('converts null billing fields to undefined', async () => {
    const { useCase, updateCalls } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase(
      {
        contactEmail: null,
        billingCompanyName: null,
        billingAddress: null,
        billingCity: null,
        billingPostalCode: null,
        billingCountry: null,
      },
      ctx,
    )

    expect(updateCalls).toHaveLength(1)
    const data = updateCalls[0]
    expect(data.contactEmail).toBeUndefined()
    expect(data.billingCompanyName).toBeUndefined()
    expect(data.billingAddress).toBeUndefined()
    expect(data.billingCity).toBeUndefined()
    expect(data.billingPostalCode).toBeUndefined()
    expect(data.billingCountry).toBeUndefined()
  })

  it('passes billing fields as strings when provided', async () => {
    const { useCase, updateCalls } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase(
      {
        contactEmail: 'billing@test.com',
        billingCompanyName: 'Test Corp',
        billingAddress: '123 Billing St',
        billingCity: 'Hong Kong',
        billingPostalCode: '00000',
        billingCountry: 'HK',
      },
      ctx,
    )

    expect(updateCalls).toHaveLength(1)
    const data = updateCalls[0]
    expect(data.contactEmail).toBe('billing@test.com')
    expect(data.billingCompanyName).toBe('Test Corp')
    expect(data.billingAddress).toBe('123 Billing St')
    expect(data.billingCity).toBe('Hong Kong')
    expect(data.billingPostalCode).toBe('00000')
    expect(data.billingCountry).toBe('HK')
  })

  it('omits name and slug when not provided', async () => {
    const { useCase, updateCalls } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ logo: 'https://example.com/new-logo.png' }, ctx)

    expect(updateCalls).toHaveLength(1)
    const data = updateCalls[0]
    expect(data).not.toHaveProperty('name')
    expect(data).not.toHaveProperty('slug')
    expect(data.logo).toBe('https://example.com/new-logo.png')
  })
})
