import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { immersiveConfiguration } from '../../domain/__fixtures__/immersive-configuration'
import { immersiveConfigurationFields } from './portal-immersive-configuration.schema'

const schema = z.object(immersiveConfigurationFields)

describe('the schema version 3 configuration fields', () => {
  it('parses a complete configuration to the same content', () => {
    const configuration = immersiveConfiguration()

    expect(schema.parse(configuration)).toEqual({
      ...configuration,
      reviewGateway: undefined,
      googleReviewBinding: undefined,
    })
  })

  it('strips a key it does not name, at every level it describes', () => {
    const configuration = immersiveConfiguration()
    const parsed = schema.parse({
      ...configuration,
      surprise: true,
      linktree: { enabled: true, surprise: true },
      brandProfile: { ...configuration.brandProfile, surprise: true },
    })

    expect(parsed).not.toHaveProperty('surprise')
    expect(parsed.linktree).toEqual({ enabled: true })
    expect(parsed.brandProfile).not.toHaveProperty('surprise')
  })

  it('rejects a locale key that is not in the catalogue', () => {
    const configuration = immersiveConfiguration()
    const english = configuration.localizedContent.en

    const result = schema.safeParse({
      ...configuration,
      localizedContent: { ...configuration.localizedContent, xx: english },
    })

    expect(result.success).toBe(false)
  })

  it.each(['http://harbor.example.com/menu', 'javascript:alert(1)', 'not a url'])(
    'rejects the link destination %j',
    (url) => {
      const configuration = immersiveConfiguration()
      const [first, ...rest] = configuration.links

      const result = schema.safeParse({
        ...configuration,
        links: [{ ...first, url }, ...rest],
      })

      expect(result.success).toBe(false)
    },
  )

  it('rejects a schema version other than 3', () => {
    expect(
      schema.safeParse({ ...immersiveConfiguration(), schemaVersion: 2 }).success,
    ).toBe(false)
  })
})
