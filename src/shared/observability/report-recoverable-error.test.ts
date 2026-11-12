import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportRecoverableError } from './report-recoverable-error'

describe('reportRecoverableError', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reports the error and names the component stack', () => {
    const report = vi.fn()
    vi.stubGlobal('reportError', report)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = new Error('Minified React error #418')

    reportRecoverableError(error, { componentStack: '\n    at Bell\n    at Shell' })

    expect(report).toHaveBeenCalledWith(error)
    expect(warn).toHaveBeenCalledWith(
      'React recovered from a render error in:',
      '\n    at Bell\n    at Shell',
    )
  })

  it('falls back to console.error where reportError is missing, and stays quiet without a stack', () => {
    vi.stubGlobal('reportError', undefined)
    const fail = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = new Error('x')

    reportRecoverableError(error, {})

    expect(fail).toHaveBeenCalledWith(error)
    expect(warn).not.toHaveBeenCalled()
  })
})
