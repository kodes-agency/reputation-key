import { HTTPError } from 'nitro/h3'
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

  it('does not report the 404 Nitro answers for a public asset it does not list', () => {
    // nitro/runtime/internal/static: an unlisted id under a public-asset base
    // throws exactly this, e.g. GET /assets/<chunk>.js.map once maps are withheld.
    const { errorHook, monitor } = harness()

    errorHook(new HTTPError({ status: 404 }), { tags: ['request'] })

    expect(monitor.captureException).not.toHaveBeenCalled()
  })

  it('reports a listed public asset that cannot be read', () => {
    // The pre-fix defect: h3 wraps the handler's ENOENT in an HTTP 500.
    const { errorHook, monitor } = harness()
    const missing = Object.assign(new Error('ENOENT: no such file or directory'), {
      code: 'ENOENT',
    })

    errorHook(new HTTPError({ status: 500, cause: missing }), { tags: ['request'] })

    expect(monitor.captureException).toHaveBeenCalledOnce()
  })

  it('captures HTTP 5xx errors', () => {
    const { errorHook, monitor } = harness()
    const error = Object.assign(new Error('handler failed'), { statusCode: 503 })

    errorHook(error, { tags: ['request'] })

    expect(monitor.captureException).toHaveBeenCalledOnce()
  })
})
