import { describe, expect, it } from 'vitest'
import {
  inviteOrganizationAdminInputSchema,
  organizationInvitationInputSchema,
  provisionOrganizationInputSchema,
} from './platform-console.dto'

describe('provisionOrganizationInputSchema', () => {
  it('trims the name and normalizes the first admin email', () => {
    expect(
      provisionOrganizationInputSchema.parse({
        name: '  Hotel Riviera  ',
        adminEmail: '  Admin@Riviera.Example ',
      }),
    ).toEqual({ name: 'Hotel Riviera', adminEmail: 'admin@riviera.example' })
  })

  it('lowercases an explicit slug and keeps it', () => {
    expect(
      provisionOrganizationInputSchema.parse({
        name: 'Hotel Riviera',
        slug: ' Riviera-HQ ',
        adminEmail: 'admin@riviera.example',
      }).slug,
    ).toBe('riviera-hq')
  })

  it.each([
    ['a name shorter than 2 characters', { name: 'A', adminEmail: 'a@b.example' }],
    [
      'a name longer than 100 characters',
      { name: 'n'.repeat(101), adminEmail: 'a@b.example' },
    ],
    ['an address that is not an email', { name: 'Riviera', adminEmail: 'not-an-email' }],
    [
      'a slug with a trailing hyphen',
      { name: 'Riviera', slug: 'riviera-', adminEmail: 'a@b.example' },
    ],
    [
      'a slug with symbols',
      { name: 'Riviera', slug: 'riviera_hq', adminEmail: 'a@b.example' },
    ],
    [
      'a slug over 63 characters',
      { name: 'Riviera', slug: 'a'.repeat(64), adminEmail: 'a@b.example' },
    ],
  ])('refuses %s', (_label, input) => {
    expect(provisionOrganizationInputSchema.safeParse(input).success).toBe(false)
  })
})

describe('inviteOrganizationAdminInputSchema', () => {
  it('normalizes the email and requires the Organization', () => {
    expect(
      inviteOrganizationAdminInputSchema.parse({
        organizationId: 'org-1',
        email: ' Second@Admin.Example',
      }),
    ).toEqual({ organizationId: 'org-1', email: 'second@admin.example' })
    expect(
      inviteOrganizationAdminInputSchema.safeParse({
        organizationId: '',
        email: 'a@b.example',
      }).success,
    ).toBe(false)
  })
})

describe('organizationInvitationInputSchema', () => {
  it('requires both ids and bounds their length', () => {
    expect(
      organizationInvitationInputSchema.parse({
        organizationId: 'org-1',
        invitationId: 'inv-1',
      }),
    ).toEqual({ organizationId: 'org-1', invitationId: 'inv-1' })
    expect(
      organizationInvitationInputSchema.safeParse({
        organizationId: 'org-1',
        invitationId: '',
      }).success,
    ).toBe(false)
    expect(
      organizationInvitationInputSchema.safeParse({
        organizationId: 'o'.repeat(65),
        invitationId: 'inv-1',
      }).success,
    ).toBe(false)
  })
})
