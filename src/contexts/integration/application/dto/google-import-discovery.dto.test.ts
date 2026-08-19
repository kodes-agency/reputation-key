import { describe, expect, it } from 'vitest'
import {
  listImportAccountsInputSchema,
  listImportCandidatesInputSchema,
  renewImportAuthorizationLeaseInputSchema,
} from './google-import-discovery.dto'

const CONNECTION_ID = '00000000-0000-4000-8000-000000000001'

describe('Google import discovery input schemas', () => {
  it('accepts a bounded cursor and rejects unknown account-list fields', () => {
    expect(
      listImportAccountsInputSchema.parse({
        connectionId: CONNECTION_ID,
        cursorRef: 'cursor-ref',
      }),
    ).toEqual({ connectionId: CONNECTION_ID, cursorRef: 'cursor-ref' })
    expect(
      listImportAccountsInputSchema.safeParse({
        connectionId: CONNECTION_ID,
        providerAccountId: 'provider-id',
      }).success,
    ).toBe(false)
  })

  it.each([{ accountRef: 'account-ref' }, { cursorRef: 'cursor-ref' }])(
    'accepts exactly one candidate discovery reference: %o',
    (reference) => {
      expect(
        listImportCandidatesInputSchema.safeParse({
          connectionId: CONNECTION_ID,
          ...reference,
        }).success,
      ).toBe(true)
    },
  )

  it.each([{}, { accountRef: 'account-ref', cursorRef: 'cursor-ref' }])(
    'rejects ambiguous candidate discovery references: %o',
    (reference) => {
      expect(
        listImportCandidatesInputSchema.safeParse({
          connectionId: CONNECTION_ID,
          ...reference,
        }).success,
      ).toBe(false)
    },
  )

  it('rejects malformed connections and oversized opaque lease references', () => {
    expect(
      renewImportAuthorizationLeaseInputSchema.safeParse({
        connectionId: 'not-a-uuid',
        leaseRef: 'lease-ref',
      }).success,
    ).toBe(false)
    expect(
      renewImportAuthorizationLeaseInputSchema.safeParse({
        connectionId: CONNECTION_ID,
        leaseRef: 'x'.repeat(513),
      }).success,
    ).toBe(false)
  })
})
