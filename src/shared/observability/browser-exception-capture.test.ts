import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureBrowserException,
  setBrowserExceptionCapture,
} from './browser-exception-capture'

describe('browser exception capture', () => {
  afterEach(() => setBrowserExceptionCapture())

  it('discards exceptions until a browser capture sink is installed', () => {
    expect(() => captureBrowserException(new Error('monitoring disabled'))).not.toThrow()
  })

  it('routes exceptions only to the currently installed capture sink', () => {
    const firstCapture = vi.fn()
    const secondCapture = vi.fn()
    const firstError = new Error('first')
    const secondError = new Error('second')

    setBrowserExceptionCapture(firstCapture)
    captureBrowserException(firstError)
    setBrowserExceptionCapture(secondCapture)
    captureBrowserException(secondError)
    setBrowserExceptionCapture()
    captureBrowserException(new Error('discarded'))

    expect(firstCapture).toHaveBeenCalledOnce()
    expect(firstCapture).toHaveBeenCalledWith(firstError)
    expect(secondCapture).toHaveBeenCalledOnce()
    expect(secondCapture).toHaveBeenCalledWith(secondError)
  })
})
