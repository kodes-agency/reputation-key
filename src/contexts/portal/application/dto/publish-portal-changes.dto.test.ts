import { describe, expect, it } from 'vitest'
import {
  MAX_PORTALS_PER_PUBLISH_BATCH,
  publishPortalChangesInputSchema,
  publishPortalsChangesInputSchema,
} from './publish-portal-changes.dto'

describe('publish changes while live: input', () => {
  it('names one Portal and the reviewed version, and nothing else', () => {
    const input = { portalId: 'p1', reviewedDigest: 'd1' }
    expect(publishPortalChangesInputSchema.safeParse(input).success).toBe(true)
    expect(publishPortalChangesInputSchema.safeParse({ portalId: 'p1' }).success).toBe(
      false,
    )
    expect(
      publishPortalChangesInputSchema.safeParse({ ...input, portalId: '' }).success,
    ).toBe(false)
    expect(
      publishPortalChangesInputSchema.safeParse({ ...input, reviewedDigest: '' }).success,
    ).toBe(false)
    expect(
      publishPortalChangesInputSchema.safeParse({ ...input, slug: 'x' }).success,
    ).toBe(false)
  })

  it('names at least one and at most the batch limit of Portals', () => {
    const ids = (count: number) => Array.from({ length: count }, (_, i) => `portal-${i}`)

    expect(publishPortalsChangesInputSchema.safeParse({ portalIds: [] }).success).toBe(
      false,
    )
    expect(
      publishPortalsChangesInputSchema.safeParse({ portalIds: ids(1) }).success,
    ).toBe(true)
    expect(
      publishPortalsChangesInputSchema.safeParse({
        portalIds: ids(MAX_PORTALS_PER_PUBLISH_BATCH),
      }).success,
    ).toBe(true)
    expect(
      publishPortalsChangesInputSchema.safeParse({
        portalIds: ids(MAX_PORTALS_PER_PUBLISH_BATCH + 1),
      }).success,
    ).toBe(false)
  })

  it('refuses an empty Portal ID and keys it does not know', () => {
    expect(publishPortalsChangesInputSchema.safeParse({ portalIds: [''] }).success).toBe(
      false,
    )
    expect(
      publishPortalsChangesInputSchema.safeParse({ portalIds: ['p1'], force: true })
        .success,
    ).toBe(false)
  })
})
