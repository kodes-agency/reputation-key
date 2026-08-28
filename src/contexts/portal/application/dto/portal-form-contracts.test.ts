import { describe, expect, it } from 'vitest'
import { createPortalGroupInputSchema } from './create-portal-group.dto'
import { createLinkCategoryInputSchema } from './portal-link-category.dto'
import { createLinkInputSchema } from './portal-link.dto'
import {
  portalApprovedDestinationRequestInputSchema,
  portalLocalizedOverrideInputSchema,
  propertyPortalBrandContentInputSchema,
  propertyPortalBrandProfileInputSchema,
} from './portal-experience.dto'
import {
  revokePortalTokensInputSchema,
  rotatePortalTokenInputSchema,
} from './portal-token-lifecycle.dto'

describe('Portal form DTO contracts', () => {
  it('normalizes names and rejects whitespace-only category data', () => {
    expect(
      createPortalGroupInputSchema.parse({ propertyId: 'property-1', name: '  Lobby  ' }),
    ).toMatchObject({ name: 'Lobby' })
    expect(
      createLinkCategoryInputSchema.safeParse({ portalId: 'portal-1', title: '   ' })
        .success,
    ).toBe(false)
  })

  it('uses the server link contract as the HTTPS-only form authority', () => {
    expect(
      createLinkInputSchema.safeParse({
        categoryId: 'category-1',
        portalId: 'portal-1',
        label: 'Website',
        url: 'http://example.com',
      }).success,
    ).toBe(false)
    expect(
      createLinkInputSchema.parse({
        categoryId: 'category-1',
        portalId: 'portal-1',
        label: '  Website  ',
        url: '  https://example.com  ',
      }),
    ).toMatchObject({ label: 'Website', url: 'https://example.com' })
  })

  it('enforces accessible brand contrast and normalized localized content', () => {
    const baseProfile = {
      propertyId: 'property-1',
      displayName: 'Hotel',
      primaryColor: '#2563EB',
      backgroundColor: '#FFFFFF',
      textColor: '#111827',
    }
    expect(propertyPortalBrandProfileInputSchema.safeParse(baseProfile).success).toBe(
      true,
    )
    expect(
      propertyPortalBrandProfileInputSchema.safeParse({
        ...baseProfile,
        textColor: '#FFFFFF',
      }).success,
    ).toBe(false)
    expect(
      propertyPortalBrandContentInputSchema.parse({
        propertyId: 'property-1',
        locale: 'en',
        title: '  Welcome  ',
        shortDescription: '  Tell us about your stay.  ',
      }),
    ).toMatchObject({
      title: 'Welcome',
      shortDescription: 'Tell us about your stay.',
    })
  })

  it('maps empty Portal overrides to inheritance at the shared boundary', () => {
    expect(
      portalLocalizedOverrideInputSchema.parse({
        portalId: 'portal-1',
        locale: 'bg',
        title: '',
        shortDescription: '',
      }),
    ).toMatchObject({ title: null, shortDescription: null })
  })

  it('rejects unsafe custom destinations before invoking the command', () => {
    for (const uri of [
      'http://example.com',
      'https://user:secret@example.com',
      'https://localhost/path',
      'https://example.com/path#fragment',
    ]) {
      expect(
        portalApprovedDestinationRequestInputSchema.safeParse({
          portalId: 'portal-1',
          uri,
        }).success,
        uri,
      ).toBe(false)
    }
  })

  it('keeps token transition and revocation constraints shared with the server', () => {
    expect(
      rotatePortalTokenInputSchema.safeParse({
        portalId: 'portal-1',
        replacementKind: 'planned',
        gracePeriodDays: 30,
      }).success,
    ).toBe(true)
    expect(
      rotatePortalTokenInputSchema.safeParse({
        portalId: 'portal-1',
        replacementKind: 'security',
        gracePeriodDays: 30,
      }).success,
    ).toBe(false)
    expect(
      revokePortalTokensInputSchema.parse({
        portalId: 'portal-1',
        reason: '  Printed code was misplaced  ',
      }).reason,
    ).toBe('Printed code was misplaced')
    expect(
      revokePortalTokensInputSchema.safeParse({ portalId: 'portal-1', reason: '  ' })
        .success,
    ).toBe(false)
  })
})
