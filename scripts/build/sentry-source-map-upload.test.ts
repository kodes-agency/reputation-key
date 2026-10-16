import { describe, expect, it } from 'vitest'
import type { Plugin } from 'vite'
import { onlyFor, sentrySourceMapUpload } from './sentry-source-map-upload'

type Environment = Parameters<NonNullable<Plugin['applyToEnvironment']>>[0]

function environment(consumer: 'client' | 'server'): Environment {
  return { config: { consumer } } as unknown as Environment
}

function appliesTo(plugin: Plugin, consumer: 'client' | 'server'): boolean {
  return plugin.applyToEnvironment?.(environment(consumer)) === true
}

describe('onlyFor', () => {
  it('keeps a plugin out of the other consumer', () => {
    const [plugin] = onlyFor('client', [{ name: 'a' }])

    expect(appliesTo(plugin!, 'client')).toBe(true)
    expect(appliesTo(plugin!, 'server')).toBe(false)
  })

  it("keeps a plugin's own environment filter", () => {
    const [plugin] = onlyFor('server', [{ name: 'b', applyToEnvironment: () => false }])

    expect(appliesTo(plugin!, 'server')).toBe(false)
  })

  it('flattens nested plugin lists and drops empty entries', () => {
    expect(
      onlyFor('server', [[{ name: 'c' }, null], false, { name: 'd' }]).map(
        ({ name }) => name,
      ),
    ).toEqual(['c', 'd'])
  })
})

describe('sentrySourceMapUpload', () => {
  const plugins = sentrySourceMapUpload({
    SENTRY_AUTH_TOKEN: 'sntrys_test',
    SENTRY_ORG: 'example',
    SENTRY_PROJECT: 'example',
    SOURCE_REVISION: 'a'.repeat(40),
  })

  // A debug id is a snippet in every browser chunk (+16.8 KB gzip on first
  // paint); the browser's maps are matched by release instead. The plugin
  // that turns debug-id source maps on exists for the server only, and each
  // consumer has its own Sentry Vite plugin (the browser's with debug ids off).
  it('turns debug-id source maps on for the server only', () => {
    const sourceMaps = plugins.filter(
      ({ name }) => name === 'sentry-tanstackstart-react-source-maps',
    )
    const uploaders = plugins.filter(({ name }) => name === 'sentry-vite-plugin')

    expect(sourceMaps).toHaveLength(1)
    expect(appliesTo(sourceMaps[0]!, 'server')).toBe(true)
    expect(appliesTo(sourceMaps[0]!, 'client')).toBe(false)
    expect(uploaders.map((plugin) => appliesTo(plugin, 'client'))).toEqual([false, true])
  })

  it('gives every plugin exactly one consumer', () => {
    for (const plugin of plugins) {
      expect(appliesTo(plugin, 'client')).not.toBe(appliesTo(plugin, 'server'))
    }
  })
})
