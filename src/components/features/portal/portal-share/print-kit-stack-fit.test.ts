import { describe, expect, it } from 'vitest'
import { PRINT_KIT_COPY, type PrintTextBlock } from '#/shared/domain/portal-print-kit'
import {
  SINGLE_LANGUAGE_SCALE,
  STACK_FIT,
  STACK_GAP_BELOW_MM,
  STACK_TOP_MM,
} from '#/shared/domain/portal-print-kit-layout'
import { previewAddress, previewPlateTopMm } from './print-kit-art-layout'
import { previewStackHeightMm, previewStackScale } from './print-kit-stack-fit'

/** The room above the code on a panel whose address is one short line. */
const ROOM_MM =
  previewPlateTopMm(previewAddress('portal.example.com')) -
  STACK_GAP_BELOW_MM -
  STACK_TOP_MM

const block = (
  locale: 'en' | 'bg' | 'fr',
  callToAction: 'rate' | 'tell',
  kicker: string,
): PrintTextBlock => ({ locale, kicker, ...PRINT_KIT_COPY[locale][callToAction] })

describe('previewStackScale', () => {
  it('sets short words in one language at the full size, as the file does', () => {
    expect(previewStackScale([block('en', 'rate', 'Pool bar')], ROOM_MM)).toBe(
      SINGLE_LANGUAGE_SCALE,
    )
  })

  it('sets two short languages at scale 1', () => {
    expect(
      previewStackScale(
        [block('en', 'rate', 'Pool bar'), block('bg', 'rate', 'Бар до басейна')],
        ROOM_MM,
      ),
    ).toBe(1)
  })

  it('shrinks a long headline under a two-line title until it fits above the code', () => {
    const long = [
      block('fr', 'tell', 'Restaurant panoramique et terrasse du dernier étage'),
    ]
    expect(previewStackHeightMm(long, SINGLE_LANGUAGE_SCALE)).toBeGreaterThan(ROOM_MM)

    const scale = previewStackScale(long, ROOM_MM)

    expect(scale).toBeLessThan(SINGLE_LANGUAGE_SCALE)
    expect(previewStackHeightMm(long, scale)).toBeLessThanOrEqual(ROOM_MM)
  })

  it('stops at the floor the file stops at, however little room there is', () => {
    expect(previewStackScale([block('fr', 'tell', 'Terrasse')], 5)).toBe(
      STACK_FIT.minScale,
    )
  })

  it('grows with every part of the stack, so a second language takes room', () => {
    const one = [block('en', 'rate', 'Pool bar')]
    const two = [...one, block('bg', 'rate', 'Бар до басейна')]
    expect(previewStackHeightMm(two, 1)).toBeGreaterThan(previewStackHeightMm(one, 1))
  })
})
