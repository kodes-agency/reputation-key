import { describe, expect, it } from 'vitest'
import { maskedLayoutSnapshotSchema } from './beta-feedback-contract'
import {
  buildMaskedLayoutSnapshot,
  renderMaskedLayoutSvg,
} from './masked-layout-snapshot'

describe('masked beta-feedback layout snapshot', () => {
  it('clips and quantizes geometry into a bounded content-free grid', () => {
    const snapshot = buildMaskedLayoutSnapshot(
      [
        { kind: 'surface', left: -20, top: -20, right: 1_200, bottom: 900 },
        { kind: 'text', left: 120, top: 100, right: 620, bottom: 140 },
        { kind: 'input', left: 120, top: 180, right: 520, bottom: 230 },
        { kind: 'image', left: 5_000, top: 5_000, right: 6_000, bottom: 6_000 },
      ],
      { width: 1_200, height: 800 },
    )

    expect(maskedLayoutSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(snapshot).toMatchObject({
      profile: 'masked-layout-v1',
      consented: true,
      gridWidth: 64,
      gridHeight: 43,
    })
    expect(snapshot.blocks).toHaveLength(3)
    expect(snapshot.blocks[0]).toEqual({
      kind: 'surface',
      x: 0,
      y: 0,
      width: 64,
      height: 43,
    })
  })

  it('deduplicates and caps blocks before anything crosses the boundary', () => {
    const candidates = Array.from({ length: 150 }, (_, index) => ({
      kind: 'text' as const,
      left: index % 2 === 0 ? 10 : 20,
      top: index,
      right: index % 2 === 0 ? 200 : 210,
      bottom: index + 10,
    }))
    const snapshot = buildMaskedLayoutSnapshot(candidates, {
      width: 1_000,
      height: 1_000,
    })

    expect(snapshot.blocks.length).toBeLessThanOrEqual(96)
    expect(new Set(snapshot.blocks.map((block) => JSON.stringify(block))).size).toBe(
      snapshot.blocks.length,
    )
  })

  it('renders an SVG from closed geometry without accepting text, image, or media bytes', () => {
    const snapshot = buildMaskedLayoutSnapshot(
      [{ kind: 'media', left: 0, top: 0, right: 400, bottom: 200 }],
      { width: 400, height: 300 },
    )
    const svg = renderMaskedLayoutSvg(snapshot)

    expect(svg).toContain('<svg')
    expect(svg).toContain('data-mask-kind="media"')
    expect(svg).toContain('Masked layout preview')
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('data:')
    expect(new TextEncoder().encode(svg).byteLength).toBeLessThan(32_000)
  })
})
