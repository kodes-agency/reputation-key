import { describe, expect, it } from 'vitest'
import {
  allImageChecksPass,
  checkImageFacts,
  describeImageFacts,
  type ImageFacts,
} from './image-checks'

const facts = (overrides: Partial<ImageFacts> = {}): ImageFacts => ({
  type: 'image/jpeg',
  bytes: 3_400_000,
  width: 4032,
  height: 3024,
  ...overrides,
})

describe('checkImageFacts', () => {
  it('passes a photograph that is big enough, in a format we take, within the limit', () => {
    const checks = checkImageFacts('hero', facts())

    expect(checks).toEqual([
      {
        id: 'size',
        passed: true,
        label:
          'Large enough for every phone (needs 1000 px on the long side and 500 px on the short)',
      },
      { id: 'format', passed: true, label: 'JPG, PNG or WebP, up to 10 MB' },
    ])
    expect(allImageChecksPass(checks)).toBe(true)
  })

  it('fails a photograph that is too small, naming what it needs', () => {
    const checks = checkImageFacts('hero', facts({ width: 800, height: 600 }))

    expect(checks[0]).toMatchObject({
      id: 'size',
      passed: false,
      label: expect.stringMatching(/^Too small to stay sharp on a phone \(needs 1000 px/),
    })
    expect(allImageChecksPass(checks)).toBe(false)
  })

  it('shows the shape only when the picture is too wide or too tall', () => {
    const odd = checkImageFacts('hero', facts({ width: 6000, height: 1000 }))

    expect(odd.map((check) => check.id)).toEqual(['size', 'shape', 'format'])
    expect(odd[1]).toMatchObject({
      passed: false,
      label: expect.stringMatching(/4 times/),
    })
    expect(checkImageFacts('hero', facts()).map((check) => check.id)).toEqual([
      'size',
      'format',
    ])
  })

  it.each([
    ['a format we do not take', facts({ type: 'image/heic' }), /JPEG, PNG or WebP/],
    ['a file over the limit', facts({ bytes: 10 * 1024 * 1024 + 1 }), /Over 10 MB/],
  ])('fails %s', (_label, image, message) => {
    const format = checkImageFacts('hero', image).find((check) => check.id === 'format')

    expect(format).toMatchObject({ passed: false, label: expect.stringMatching(message) })
  })

  it('holds a logo to its own, smaller minimum and says so in its own words', () => {
    const small = checkImageFacts(
      'logo',
      facts({ type: 'image/png', width: 120, height: 40 }),
    )
    const fine = checkImageFacts(
      'logo',
      facts({ type: 'image/png', width: 480, height: 120 }),
    )

    expect(small[0]).toMatchObject({
      passed: false,
      label: expect.stringMatching(/needs 128 px/),
    })
    expect(fine[0]).toMatchObject({
      passed: true,
      label: expect.stringMatching(/^Large enough to stay sharp/),
    })
  })
})

describe('describeImageFacts', () => {
  it('prints the size in pixels and the weight in the units the limit uses', () => {
    expect(describeImageFacts(facts({ bytes: 3_355_443 }))).toBe('4032 × 3024 · 3.2 MB')
    expect(describeImageFacts(facts({ bytes: 20_480, width: 480, height: 120 }))).toBe(
      '480 × 120 · 20 KB',
    )
    expect(describeImageFacts(facts({ bytes: 10 }))).toBe('4032 × 3024 · 1 KB')
  })
})
