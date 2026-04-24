// Property context — domain constructors tests
// 100% coverage on buildProperty smart constructor.

import { describe, it, expect } from 'vitest'
import { buildProperty } from './constructors'
import { propertyId, organizationId } from '#/shared/domain/ids'

const FIXED_ID = propertyId('prop-00000000-0000-0000-0000-000000000001')
const FIXED_ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

describe('buildProperty', () => {
  it('creates a property with all valid fields', () => {
    const result = buildProperty({
      id: FIXED_ID,
      organizationId: FIXED_ORG,
      name: 'Grand Hotel',
      timezone: 'America/New_York',
      now: FIXED_TIME,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const prop = result.value
      expect(prop.id).toBe(FIXED_ID)
      expect(prop.organizationId).toBe(FIXED_ORG)
      expect(prop.name).toBe('Grand Hotel')
      expect(prop.slug).toBe('grand-hotel')
      expect(prop.timezone).toBe('America/New_York')
      expect(prop.gbpPlaceId).toBeNull()
      expect(prop.createdAt).toBe(FIXED_TIME)
      expect(prop.updatedAt).toBe(FIXED_TIME)
      expect(prop.deletedAt).toBeNull()
    }
  })

  it('uses provided slug when given', () => {
    const result = buildProperty({
      id: FIXED_ID,
      organizationId: FIXED_ORG,
      name: 'Grand Hotel',
      providedSlug: 'custom-slug',
      timezone: 'Europe/London',
      now: FIXED_TIME,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.slug).toBe('custom-slug')
    }
  })

  it('sets gbpPlaceId when provided', () => {
    const result = buildProperty({
      id: FIXED_ID,
      organizationId: FIXED_ORG,
      name: 'Grand Hotel',
      timezone: 'UTC',
      gbpPlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      now: FIXED_TIME,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.gbpPlaceId).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4')
    }
  })

  it('rejects invalid name', () => {
    const result = buildProperty({
      id: FIXED_ID,
      organizationId: FIXED_ORG,
      name: '',
      timezone: 'UTC',
      now: FIXED_TIME,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_name')
    }
  })

  it('rejects invalid slug', () => {
    const result = buildProperty({
      id: FIXED_ID,
      organizationId: FIXED_ORG,
      name: 'Valid Name',
      providedSlug: 'INVALID',
      timezone: 'UTC',
      now: FIXED_TIME,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_slug')
    }
  })

  it('rejects invalid timezone', () => {
    const result = buildProperty({
      id: FIXED_ID,
      organizationId: FIXED_ORG,
      name: 'Valid Name',
      timezone: 'Invalid/Timezone',
      now: FIXED_TIME,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_timezone')
    }
  })

  it('generates slug from name when not provided', () => {
    const result = buildProperty({
      id: FIXED_ID,
      organizationId: FIXED_ORG,
      name: 'My Cool Hotel',
      timezone: 'UTC',
      now: FIXED_TIME,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.slug).toBe('my-cool-hotel')
    }
  })
})
