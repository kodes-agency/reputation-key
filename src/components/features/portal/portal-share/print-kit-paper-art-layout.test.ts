import { describe, expect, it } from 'vitest'
import { ptToContainerWidth } from './print-kit-paper-art-layout'
describe('ptToContainerWidth', () => {
  it('turns points into a share of the face’s width', () => {
    expect(ptToContainerWidth(144, 288)).toBe('50cqw')
    expect(ptToContainerWidth(18, 612)).toBe('2.9412cqw')
  })
})
