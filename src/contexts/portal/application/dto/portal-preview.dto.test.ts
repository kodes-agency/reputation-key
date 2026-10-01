import { describe, expect, it } from 'vitest'
import { portalPreviewInputSchema } from './portal-preview.dto'

describe('portalPreviewInputSchema', () => {
  it.each(['draft', 'live'])('accepts the %s source', (source) => {
    expect(portalPreviewInputSchema.safeParse({ portalId: 'p-1', source }).success).toBe(
      true,
    )
  })

  it('refuses a source the preview does not offer', () => {
    expect(
      portalPreviewInputSchema.safeParse({ portalId: 'p-1', source: 'archive' }).success,
    ).toBe(false)
  })

  it('refuses a missing source and an empty Portal id', () => {
    expect(portalPreviewInputSchema.safeParse({ portalId: 'p-1' }).success).toBe(false)
    expect(
      portalPreviewInputSchema.safeParse({ portalId: '', source: 'draft' }).success,
    ).toBe(false)
  })
})
