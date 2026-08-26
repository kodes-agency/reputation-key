import { describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [] as string[])

vi.mock('dotenv/config', () => {
  calls.push('dotenv')
  return {}
})

vi.mock('./telemetry', () => ({
  initObservability(service: string) {
    calls.push(`init:${service}`)
  },
}))

// Static side-effect imports deliberately make this test the runtime contract
// owner recognized by the changed-code gate. Their order is the production
// Node --import contract: load environment, initialize web, initialize worker.
import './web-observability-preload'
import './worker-observability-preload'

describe('observability process preloads', () => {
  it('loads environment configuration before initializing each process service', () => {
    expect(calls).toEqual(['dotenv', 'init:web', 'init:worker'])
  })
})
