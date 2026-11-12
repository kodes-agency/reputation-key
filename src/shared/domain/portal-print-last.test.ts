import { describe, expect, it } from 'vitest'
import { printPhotoChange, type PrintLastPhoto } from './portal-print-last'

const PRINTED_AT = new Date('2026-10-12T09:00:00.000Z')
const BEFORE = new Date('2026-10-01T09:00:00.000Z')
const AFTER = new Date('2026-10-20T09:00:00.000Z')

const photo = (assetId: string, focalX = 0.5, focalY = 0.4): PrintLastPhoto => ({
  assetId,
  focalX,
  focalY,
})

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('printPhotoChange', () => {
  it('says nothing about the photo of a Paper print, which carries none', () => {
    expect(
      printPhotoChange({
        last: { look: 'paper', photo: photo(A), printedAt: PRINTED_AT },
        current: { photo: photo(B), addedAt: AFTER },
      }),
    ).toEqual({ kind: 'same' })
  })

  it('reads the same photo, framed the same, as unchanged', () => {
    expect(
      printPhotoChange({
        last: { look: 'immersive', photo: photo(A), printedAt: PRINTED_AT },
        current: { photo: photo(A), addedAt: BEFORE },
      }),
    ).toEqual({ kind: 'same' })
  })

  it('reads no photo then and none now as unchanged', () => {
    expect(
      printPhotoChange({
        last: { look: 'immersive', photo: null, printedAt: PRINTED_AT },
        current: { photo: null, addedAt: null },
      }),
    ).toEqual({ kind: 'same' })
  })

  it('dates a photo that was added after the print by when it was added', () => {
    expect(
      printPhotoChange({
        last: { look: 'immersive', photo: photo(A), printedAt: PRINTED_AT },
        current: { photo: photo(B), addedAt: AFTER },
      }),
    ).toEqual({ kind: 'changed', on: AFTER.toISOString() })
  })

  it('dates a photo that appeared where there was none', () => {
    expect(
      printPhotoChange({
        last: { look: 'immersive', photo: null, printedAt: PRINTED_AT },
        current: { photo: photo(B), addedAt: AFTER },
      }),
    ).toEqual({ kind: 'changed', on: AFTER.toISOString() })
  })

  it('gives no date when the new photo was added before the print: it was only chosen since', () => {
    expect(
      printPhotoChange({
        last: { look: 'immersive', photo: photo(A), printedAt: PRINTED_AT },
        current: { photo: photo(B), addedAt: BEFORE },
      }),
    ).toEqual({ kind: 'changed', on: null })
  })

  it('gives no date when only the framing moved', () => {
    expect(
      printPhotoChange({
        last: { look: 'immersive', photo: photo(A, 0.5, 0.4), printedAt: PRINTED_AT },
        current: { photo: photo(A, 0.2, 0.4), addedAt: BEFORE },
      }),
    ).toEqual({ kind: 'changed', on: null })
  })

  it('ignores a framing difference below the rounding the framing is stored to', () => {
    expect(
      printPhotoChange({
        last: { look: 'immersive', photo: photo(A, 0.5, 0.4), printedAt: PRINTED_AT },
        current: { photo: photo(A, 0.5000000001, 0.4), addedAt: BEFORE },
      }),
    ).toEqual({ kind: 'same' })
  })

  it('says a photo that was taken off since the print was removed', () => {
    expect(
      printPhotoChange({
        last: { look: 'immersive', photo: photo(A), printedAt: PRINTED_AT },
        current: { photo: null, addedAt: null },
      }),
    ).toEqual({ kind: 'removed' })
  })
})
