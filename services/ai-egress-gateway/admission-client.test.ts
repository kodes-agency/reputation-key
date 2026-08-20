import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAiAdmissionClient,
  type AiAdmissionByteTransport,
} from './admission-client'

describe('AI admission readiness client', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes the caller signal into the readiness GET and returns when it aborts', async () => {
    vi.useFakeTimers()
    let observedSignal: AbortSignal | undefined
    const transport: AiAdmissionByteTransport = {
      postBytesRaw: async () => {
        throw new Error('not used')
      },
      get: async (_path, options) => {
        observedSignal = options.signal
        return await new Promise<never>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        })
      },
    }
    const controller = new AbortController()
    const readiness = createAiAdmissionClient(transport).readiness(controller.signal)
    setTimeout(() => controller.abort(), 5_000)

    await vi.advanceTimersByTimeAsync(5_000)
    await expect(readiness).resolves.toBe(false)
    expect(observedSignal).toBe(controller.signal)
  })
})
