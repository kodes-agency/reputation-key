// Identity context — update organization use case tests

import { describe, it, expect } from 'vitest'
import { updateOrganization } from './update-organization'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'

// ── Setup ────────────────────────────────────────────────────────

const setup = () => {
  const updateCalls: Array<{ headers: Headers; data: Record<string, unknown> }> = []
  const updateOrg = async (headers: Headers, data: Record<string, unknown>) => {
    updateCalls.push({ headers, data })
  }
  let headersValue: Headers | undefined = new Headers()
  const getHeaders = () => headersValue

  const deps = { updateOrg, getHeaders }
  const useCase = updateOrganization(deps)

  return { useCase, updateCalls, setHeaders: (h: Headers | undefined) => { headersValue = h } }
}

// ── Tests ────────────────────────────────────────────────────────

describe('updateOrganization', () => {
  it('happy path: AccountAdmin can update organization name and slug', async () => {
    const { useCase, updateCalls, setHeaders } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    setHeaders(new Headers())

    await useCase({ name: 'New Org Name', slug: 'new-org-slug' }, ctx)

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].data).toEqual({
      name: 'New Org Name',
      slug: 'new-org-slug',
    })
  })

  it('happy path: PropertyManager can update organization', async () => {
    const { useCase, updateCalls, setHeaders } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    setHeaders(new Headers())

    await useCase({ name: 'PM Org Name' }, ctx)

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].data.name).toBe('PM Org Name')
  })

  it('rejects Staff from updating organization → forbidden', async () => {
    const { useCase, setHeaders } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })
    setHeaders(new Headers())

    await expect(
      useCase({ name: 'Staff Org' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects when headers are not available → validation_error', async () => {
    const { useCase, setHeaders } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    setHeaders(undefined)

    await expect(
      useCase({ name: 'No Headers' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && (e as { code: string }).code === 'validation_error',
    )
  })

  it('converts null logo to undefined for Better Auth', async () => {
    const { useCase, updateCalls, setHeaders } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    setHeaders(new Headers())

    await useCase({ logo: null }, ctx)

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].data.logo).toBeUndefined()
  })

  it('passes logo value when provided', async () => {
    const { useCase, updateCalls, setHeaders } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    setHeaders(new Headers())

    await useCase({ logo: 'https://example.com/logo.png' }, ctx)

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].data.logo).toBe('https://example.com/logo.png')
  })

  it('converts null billing fields to undefined', async () => {
    const { useCase, updateCalls, setHeaders } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    setHeaders(new Headers())

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
    const data = updateCalls[0].data
    expect(data.contactEmail).toBeUndefined()
    expect(data.billingCompanyName).toBeUndefined()
    expect(data.billingAddress).toBeUndefined()
    expect(data.billingCity).toBeUndefined()
    expect(data.billingPostalCode).toBeUndefined()
    expect(data.billingCountry).toBeUndefined()
  })

  it('passes billing fields as strings when provided', async () => {
    const { useCase, updateCalls, setHeaders } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    setHeaders(new Headers())

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
    const data = updateCalls[0].data
    expect(data.contactEmail).toBe('billing@test.com')
    expect(data.billingCompanyName).toBe('Test Corp')
    expect(data.billingAddress).toBe('123 Billing St')
    expect(data.billingCity).toBe('Hong Kong')
    expect(data.billingPostalCode).toBe('00000')
    expect(data.billingCountry).toBe('HK')
  })

  it('omits name and slug when not provided', async () => {
    const { useCase, updateCalls, setHeaders } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    setHeaders(new Headers())

    await useCase({ logo: 'https://example.com/new-logo.png' }, ctx)

    expect(updateCalls).toHaveLength(1)
    const data = updateCalls[0].data
    expect(data).not.toHaveProperty('name')
    expect(data).not.toHaveProperty('slug')
    expect(data.logo).toBe('https://example.com/new-logo.png')
  })

  it('passes headers to updateOrg', async () => {
    const { useCase, updateCalls, setHeaders } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const testHeaders = new Headers({ authorization: 'Bearer test-token' })
    setHeaders(testHeaders)

    await useCase({ name: 'Headers Test' }, ctx)

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].headers).toBe(testHeaders)
  })
})
