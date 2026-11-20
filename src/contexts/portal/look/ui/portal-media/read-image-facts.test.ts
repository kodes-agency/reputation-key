import { describe, expect, it } from 'vitest'
import { PREVIEW_MAX_EDGE, previewSize } from './read-image-facts'

describe('previewSize', () => {
  it('scales a large picture down to the longest side, keeping its shape', () => {
    expect(previewSize(4032, 3024)).toEqual({ width: PREVIEW_MAX_EDGE, height: 900 })
    expect(previewSize(3024, 4032)).toEqual({ width: 900, height: PREVIEW_MAX_EDGE })
  })

  it('never scales a small picture up', () => {
    expect(previewSize(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('keeps at least one pixel on a very thin picture', () => {
    expect(previewSize(10_000, 1)).toEqual({ width: PREVIEW_MAX_EDGE, height: 1 })
  })

  it('takes the longest side as a parameter', () => {
    expect(previewSize(2000, 1000, 500)).toEqual({ width: 500, height: 250 })
  })
})
