import { describe, expect, it, vi } from 'vitest'
import { createNitroErrorMonitoringPlugin } from './nitro-error-monitoring'

function harness() {
  let errorHook: ((error: Error, context: { tags?: string[] }) => void) | undefined
  const monitor = {
    initialize: vi.fn(),
    captureException: vi.fn(),
  }
  const plugin = createNitroErrorMonitoringPlugin(monitor)
  plugin({
    hooks: {
      hook: vi.fn((name, callback) => {
        if (name === 'error') errorHook = callback
      }),
    },
  })
  if (!errorHook) throw new Error('error hook was not registered')
  return { errorHook, monitor }
}

describe('Nitro error monitoring plugin', () => {
  it('initializes web monitoring and captures unexpected server errors', () => {
    const { errorHook, monitor } = harness()
    const error = new Error('database failed')

    errorHook(error, { tags: ['request'] })

    expect(monitor.initialize).toHaveBeenCalledWith('web')
    expect(monitor.captureException).toHaveBeenCalledWith(error, {
      source: 'nitro',
    })
  })

  it.each([400, 401, 403, 404, 429])(
    'does not turn an expected HTTP %s response into an issue',
    (statusCode) => {
      const { errorHook, monitor } = harness()
      const error = Object.assign(new Error('expected request rejection'), { statusCode })

      errorHook(error, { tags: ['request'] })

      expect(monitor.captureException).not.toHaveBeenCalled()
    },
  )

  it('captures HTTP 5xx errors', () => {
    const { errorHook, monitor } = harness()
    const error = Object.assign(new Error('handler failed'), { statusCode: 503 })

    errorHook(error, { tags: ['request'] })

    expect(monitor.captureException).toHaveBeenCalledOnce()
  })
})
