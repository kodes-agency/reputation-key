import { afterEach, describe, expect, it, vi } from 'vitest'

type DevtoolsOptions = Readonly<{ consolePiping: Readonly<{ enabled: boolean }> }>

const { devtoolsSpy } = vi.hoisted(() => ({
  devtoolsSpy: vi.fn((_options: { consolePiping: { enabled: boolean } }) => ({
    name: 'mock-tanstack-devtools',
  })),
}))

vi.mock('@tanstack/devtools-vite', () => ({ devtools: devtoolsSpy }))

async function resolveConsolePiping(): Promise<boolean> {
  // The build config sits outside the runtime architecture graph; this test
  // intentionally exercises that root-level tool boundary directly.
  // eslint-disable-next-line boundaries/no-unknown-dependencies
  const config = (await import('../../vite.config')).default
  if (typeof config !== 'function') throw new Error('Expected a Vite config factory')

  await config({
    command: 'serve',
    mode: 'development',
    isPreview: false,
    isSsrBuild: false,
  })

  const call: DevtoolsOptions | undefined = devtoolsSpy.mock.calls.at(-1)?.[0]
  if (!call) throw new Error('Expected the devtools plugin to be configured')
  return call.consolePiping.enabled
}

describe('Vite devtools console piping', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    devtoolsSpy.mockClear()
  })

  it('keeps the bidirectional console bridge off by default', async () => {
    vi.stubEnv('E2E', '')
    vi.stubEnv('REPKEY_DEVTOOLS_CONSOLE_PIPE', '')

    // The bridge mirrors the browser console into the server terminal and the
    // server log back into the browser, so one warning can echo unboundedly.
    await expect(resolveConsolePiping()).resolves.toBe(false)
  })

  it('opens the bridge only when a developer opts in', async () => {
    vi.stubEnv('E2E', '')
    vi.stubEnv('REPKEY_DEVTOOLS_CONSOLE_PIPE', '1')

    await expect(resolveConsolePiping()).resolves.toBe(true)
  })

  it('refuses the opt-in under e2e, where the echo reaches the CI log', async () => {
    vi.stubEnv('E2E', '1')
    vi.stubEnv('REPKEY_DEVTOOLS_CONSOLE_PIPE', '1')

    await expect(resolveConsolePiping()).resolves.toBe(false)
  })
})
