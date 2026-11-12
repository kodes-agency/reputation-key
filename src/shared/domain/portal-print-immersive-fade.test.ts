import { describe, expect, it } from 'vitest'
import { printBlocks } from './portal-print-languages'
import { PRINT_ORIENTATIONS, PRINT_PIECES, type PrintFace } from './portal-print'
import { choosePrintTile } from './portal-print-code'
import { printScene, type PrintScenePhoto } from './portal-print-contrast'
import { parseHexColour } from './portal-field-colour'
import { PRINT_DEFAULT_FRAMING } from './portal-print-framing'
import { layoutPrintImmersiveFace } from './portal-print-immersive-face'
import type { PrintTextMeasurer } from './portal-print-text'

// The owner's tent (2026-10-26): on a light, busy photo the words sat on a band
// much darker than the ground under it, ending in a hard edge, because the
// scrims printed over the bare ground and one shared boost blackened the
// message for the brand's sake. Down the face below the words, the art now
// changes smoothly (no step between adjacent rows) and, over a light photo, is
// never darker than the ground; every word still reaches 4.6:1.

const measurer: PrintTextMeasurer = {
  advancePt: (text, style) => style.sizePt * text.length * 0.5,
  ink: (text, style) => ({
    leftPt: 0,
    rightPt: style.sizePt * text.length * 0.5,
    ascentPt: 0.7 * style.sizePt,
    descentPt: 0.2 * style.sizePt,
  }),
}

/** A photo busy across (stripes and per-column noise) round `level`, a little lighter at the top. */
function busy(level: number, swing: number): PrintScenePhoto {
  const widthPx = 480
  const heightPx = 320
  const rgb = new Uint8ClampedArray(widthPx * heightPx * 3)
  for (let column = 0; column < widthPx; column++) {
    const stripe = Math.floor(column / 12) % 2 === 0 ? swing : -swing
    const noise = ((column * 7919) % 61) - 30
    for (let row = 0; row < heightPx; row++) {
      const value = level + stripe + noise * (swing / 60) + 20 * (1 - row / heightPx)
      rgb.set([value, value * 0.92, value * 0.82], (row * widthPx + column) * 3)
    }
  }
  const sample = { widthPx, heightPx, rgb }
  return {
    sample,
    detail: sample,
    pixels: { widthPx: 1600, heightPx: 1067 },
    focal: { x: 0.5, y: 0.5 },
    framing: PRINT_DEFAULT_FRAMING,
  }
}

const LIGHT = busy(190, 45)
const DARK = busy(28, 12)

const luma = ([r, g, b]: readonly number[]) =>
  0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)

/** Biggest change between adjacent 1 pt rows (row means across the face), in 8-bit luma. */
const STEP_MOST = 2
/** How much darker than the ground the art may print below the words over a light photo. */
const GROUND_MARGIN = 4

function faceOf(face: PrintFace, photo: PrintScenePhoto) {
  const tile = choosePrintTile({ ...face, address: 'short', symbolModules: 29 })
  return layoutPrintImmersiveFace({
    face,
    blocks: printBlocks(
      ['en'],
      { preset: 'how_did_we_do' },
      { en: 'Restaurant' },
      'Restaurant',
    ),
    brand: { kind: 'wordmark', text: 'THE LANDING' },
    tile: tile._unsafeUnwrap(),
    measurer,
    accentColour: '#2563EB',
    fieldColour: '#1E293B',
    photo,
  })
}

/** The art's mean luma along each 1 pt row from `fromPt` to `toPt`. */
function profile(
  laid: ReturnType<typeof faceOf>,
  photo: PrintScenePhoto,
  fromPt: number,
  toPt: number,
) {
  const scene = printScene(laid.art, photo)
  const width = laid.layout.plan.widthPt
  const rows: number[] = []
  for (let y = Math.ceil(fromPt); y <= toPt; y++) {
    let total = 0
    for (let x = 0.5; x < width; x++) total += luma(scene.colourAt(x, y))
    rows.push(total / Math.floor(width))
  }
  return rows
}

const FACES = PRINT_PIECES.flatMap((piece) =>
  PRINT_ORIENTATIONS.map(
    (orientation) =>
      ({ piece, orientation, look: 'immersive', region: 'us' }) as PrintFace,
  ),
)

describe('Immersive faces: the photo melts into the ground with no band', () => {
  it.each(
    FACES.flatMap((face) =>
      (['light', 'dark'] as const).map(
        (tone) =>
          [`${face.piece} ${face.orientation}, ${tone} photo`, face, tone] as const,
      ),
    ),
  )('%s', (_, face, tone) => {
    const photo = tone === 'light' ? LIGHT : DARK
    const laid = faceOf(face, photo)
    const { plan } = laid.layout
    const message = plan.groups.message!
    const end = face.orientation === 'upright' ? plan.code.topPt - 1 : plan.heightPt - 1
    const below = profile(laid, photo, message.bottomPt + 1, end)
    const steps = below
      .slice(1)
      .map((value, at) => Math.abs(value - (below[at] ?? value)))
    expect(Math.max(...steps), 'a step below the words').toBeLessThanOrEqual(STEP_MOST)
    for (const word of laid.contrasts)
      expect(word.ratio, word.key).toBeGreaterThanOrEqual(4.6)
    if (tone === 'dark') return
    const ground = luma(parseHexColour(laid.palette.ground) ?? [0, 0, 0])
    const under = profile(laid, photo, message.topPt, message.bottomPt)
    expect(
      Math.min(...below),
      'darker than the ground below the words',
    ).toBeGreaterThanOrEqual(ground - GROUND_MARGIN)
    expect(
      Math.min(...under),
      'darker than the ground under the words',
    ).toBeGreaterThanOrEqual(ground - GROUND_MARGIN)
  })
})
