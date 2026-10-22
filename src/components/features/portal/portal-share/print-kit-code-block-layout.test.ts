import { describe, expect, it } from 'vitest'
import {
  codeBlockColours,
  cueLinesFor,
  estimatedCueWidthPt,
  planCodeBlock,
} from '#/shared/domain/portal-print-kit-code-block'
import { printKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { codeBlockStyles, pointsToPixels } from './print-kit-code-block-layout'

const inPoints = (points: number) => `${Number(points.toFixed(4))}pt`

function stylesFor(
  locales: Parameters<typeof cueLinesFor>[0],
  style: 'paper' | 'immersive',
) {
  const plan = planCodeBlock(cueLinesFor(locales), estimatedCueWidthPt)
  const colours = codeBlockColours(printKitPalette('#EAD6A8', null, style))
  return { plan, colours, styles: codeBlockStyles(plan, colours, inPoints) }
}

describe('pointsToPixels', () => {
  it('draws 2 in as 192 px, 96 to the inch', () => {
    expect(pointsToPixels(144)).toBe('192px')
    expect(pointsToPixels(0.45 * 72)).toBe('43.2px')
  })
})

describe('codeBlockStyles', () => {
  it('makes the tile 2 in square and the object as wide as its bar', () => {
    const { styles } = stylesFor(['en', 'es'], 'immersive')
    expect(styles.root).toMatchObject({ width: '144pt', height: '176.4pt' })
    expect(styles.code).toMatchObject({ width: '144pt', height: '144pt' })
    expect(styles.bar).toMatchObject({ height: '32.4pt' })
  })

  it('makes the bar 0.40 in with one cue line and 0.45 in with two', () => {
    expect(stylesFor(['en'], 'immersive').styles.bar).toMatchObject({ height: '28.8pt' })
    expect(stylesFor(['en', 'es'], 'immersive').styles.bar).toMatchObject({
      height: '32.4pt',
    })
  })

  it('rounds the whole object at 0.10 in', () => {
    expect(stylesFor(['en'], 'paper').styles.root.borderRadius).toBe('7.2pt')
  })

  it('draws the outline on Paper only, outside the 2 in', () => {
    const paper = stylesFor(['en'], 'paper')
    expect(paper.colours.outline).toBe('#765B1D')
    expect(paper.styles.root.boxShadow).toBe('0 0 0 0.9921pt #765B1D')
    expect(stylesFor(['en'], 'immersive').styles.root.boxShadow).toBe('none')
  })

  it('colours the bar and its text from the palette', () => {
    const { styles } = stylesFor(['en'], 'paper')
    expect(styles.bar).toMatchObject({ background: '#EAD6A8', color: '#121614' })
  })

  it('sets the pictogram beside the lines, centred as a group, with the spec’s gap', () => {
    const { styles } = stylesFor(['en', 'es'], 'paper')
    expect(styles.bar).toMatchObject({
      flexDirection: 'row',
      justifyContent: 'center',
      gap: '5.04pt',
      padding: '0 7.2pt',
    })
    expect(styles.icon).toMatchObject({ width: '12.96pt', height: '12.96pt' })
  })

  it('stacks the pictogram above the lines, evenly spaced, when a line does not fit beside it', () => {
    const { plan, styles } = stylesFor(['fr', 'en'], 'paper')
    expect(plan.iconAbove).toBe(true)
    expect(styles.bar).toMatchObject({
      flexDirection: 'column',
      justifyContent: 'space-evenly',
      gap: 0,
    })
    expect(styles.root.height).toBe(`${plan.heightPt}pt`)
  })

  it('sets the cue at 9 pt, 600 weight, tracked at 0.005 em, on one line each', () => {
    const { styles } = stylesFor(['en', 'es'], 'paper')
    expect(styles.cue).toMatchObject({
      fontSize: '9pt',
      fontWeight: 600,
      lineHeight: 1.12,
      letterSpacing: '0.005em',
      whiteSpace: 'nowrap',
    })
    expect(stylesFor(['en'], 'paper').styles.cue.fontSize).toBe('9.5pt')
  })
})
