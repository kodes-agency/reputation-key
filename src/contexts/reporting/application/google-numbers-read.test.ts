import { describe, expect, it } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { readGoogleNumbers, type GoogleNumbersReadDeps } from './google-numbers-read'

const ORG = organizationId('org-google-numbers')
const PROPERTY = propertyId('60000000-0000-4000-8000-000000000001')
const NOW = new Date('2026-10-15T12:00:00.000Z')
const VERIFIED = new Date('2026-10-15T09:00:00.000Z')

function deps(
  overrides: Partial<{
    bindingActive: boolean
    snapshot: boolean
    property: boolean
  }> = {},
): GoogleNumbersReadDeps & { asked: string[] } {
  const { bindingActive = true, snapshot = true, property = true } = overrides
  const asked: string[] = []
  return {
    asked,
    properties: {
      findPropertyFacts: async (org, id) => {
        asked.push(`facts:${org}:${id}`)
        return property
          ? {
              timezone: 'Europe/Sofia',
              lifecycleState: 'active',
              sourceEpoch: 2,
              googleBindingActive: bindingActive,
            }
          : null
      },
    },
    google: {
      getCurrentOnGoogle: async (org, id) => {
        asked.push(`google:${org}:${id}`)
        return snapshot
          ? {
              semantics: 'current_on_google',
              organizationId: org,
              propertyId: id,
              reviewCount: 812,
              averageRating: 4.300000190734863,
              verifiedAt: VERIFIED,
            }
          : null
      },
    },
  }
}

describe('readGoogleNumbers', () => {
  it('reads Google’s number and count for the Property, current under an active binding', async () => {
    // Arrange
    const ports = deps()

    // Act
    const numbers = await readGoogleNumbers(ports, ORG, PROPERTY, NOW)

    // Assert
    expect(numbers).toEqual({
      shows: 4.3,
      reviewCount: 812,
      asOf: VERIFIED.toISOString(),
      current: true,
    })
    expect(ports.asked.sort()).toEqual([
      `facts:${ORG}:${PROPERTY}`,
      `google:${ORG}:${PROPERTY}`,
    ])
  })

  it('keeps Google’s last numbers, not current, while the binding is not active', async () => {
    // Act
    const numbers = await readGoogleNumbers(
      deps({ bindingActive: false }),
      ORG,
      PROPERTY,
      NOW,
    )

    // Assert
    expect(numbers).toMatchObject({ shows: 4.3, current: false })
  })

  it('is nothing without a snapshot for the current binding, or without the Property', async () => {
    // Act
    const [noSnapshot, noProperty] = await Promise.all([
      readGoogleNumbers(deps({ snapshot: false }), ORG, PROPERTY, NOW),
      readGoogleNumbers(deps({ property: false }), ORG, PROPERTY, NOW),
    ])

    // Assert
    expect(noSnapshot).toBeNull()
    expect(noProperty).toBeNull()
  })
})
