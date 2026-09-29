import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBuilder, type Plugin } from 'vite'
import {
  NITRO_ENVIRONMENT,
  WITHHELD_SOURCE_MAP_DIRECTORY,
  withholdClientSourceMaps,
} from './withhold-client-source-maps'

const MANIFEST_MODULE = 'virtual:public-assets-data'
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

function filesBelow(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort()
}

function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'repkey-client-source-maps-'))
  temporaryRoots.push(root)
  mkdirSync(join(root, 'src'))
  // Both modules keep code after tree-shaking, so each chunk emits a map.
  writeFileSync(
    join(root, 'src/client.js'),
    'export const load = () => import("./lazy.js")\nconsole.log(load)\n',
  )
  writeFileSync(
    join(root, 'src/lazy.js'),
    'export const lazy = () => Math.random()\nconsole.log(lazy())\n',
  )
  writeFileSync(
    join(root, 'src/server.js'),
    `import assets from '${MANIFEST_MODULE}'\nexport default assets\n`,
  )
  return root
}

/**
 * Stands in for Sentry's uploader, which reads the maps in the CLIENT
 * environment's writeBundle and, when it has a token, deletes them afterwards
 * (`sourcemaps.filesToDeleteAfterUpload`).
 */
function uploader(uploaded: string[], deleteAfterUpload: boolean): Plugin {
  return {
    name: 'test-source-map-uploader',
    enforce: 'pre',
    writeBundle(outputOptions) {
      if (this.environment.name !== 'client' || !outputOptions.dir) return
      const maps = filesBelow(outputOptions.dir).filter((file) => file.endsWith('.map'))
      uploaded.push(...maps)
      if (!deleteAfterUpload) return
      for (const map of maps) rmSync(join(outputOptions.dir, map))
    },
  }
}

/**
 * Stands in for Nitro's `#nitro/virtual/public-assets-data`, which lists every
 * file in the public directory at the moment the Nitro environment loads it.
 */
function publicAssetManifest(publicDir: string, listed: string[]): Plugin {
  const resolved = `\0${MANIFEST_MODULE}`
  return {
    name: 'test-public-asset-manifest',
    resolveId: (id) => (id === MANIFEST_MODULE ? resolved : null),
    load(id) {
      if (id !== resolved) return null
      listed.push(...filesBelow(publicDir))
      return 'export default {}\n'
    },
  }
}

async function buildLikeNitro(root: string, plugins: Plugin[]): Promise<void> {
  const builder = await createBuilder({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins,
    environments: {
      client: {
        consumer: 'client',
        build: {
          outDir: '.output/public',
          sourcemap: 'hidden',
          rolldownOptions: { input: join(root, 'src/client.js') },
        },
      },
      [NITRO_ENVIRONMENT]: {
        consumer: 'server',
        build: {
          outDir: '.output/server',
          rolldownOptions: { input: join(root, 'src/server.js') },
        },
      },
    },
    // Nitro's own order: every client environment is built, then Nitro's.
    builder: {
      sharedConfigBuild: true,
      buildApp: async (app) => {
        await app.build(app.environments.client)
        await app.build(app.environments[NITRO_ENVIRONMENT])
      },
    },
  })
  await builder.buildApp()
}

describe('withholding client source maps from the served directory', () => {
  it('lets the uploader read the maps, then keeps them out of the public-asset manifest', async () => {
    const root = projectRoot()
    const uploaded: string[] = []
    const listed: string[] = []

    await buildLikeNitro(root, [
      uploader(uploaded, false),
      publicAssetManifest(join(root, '.output/public'), listed),
      withholdClientSourceMaps(),
    ])

    expect(uploaded).toHaveLength(2)
    expect(listed.filter((file) => file.endsWith('.js'))).toHaveLength(2)
    expect(listed.filter((file) => file.endsWith('.map'))).toEqual([])
    // Moved beside the served directory, where a local build can still read them.
    expect(filesBelow(join(root, '.output', WITHHELD_SOURCE_MAP_DIRECTORY))).toEqual(
      uploaded,
    )
  })

  it('tolerates maps the uploader already deleted after uploading them', async () => {
    const root = projectRoot()
    const uploaded: string[] = []
    const listed: string[] = []

    await buildLikeNitro(root, [
      uploader(uploaded, true),
      publicAssetManifest(join(root, '.output/public'), listed),
      withholdClientSourceMaps(),
    ])

    expect(uploaded).toHaveLength(2)
    expect(listed.filter((file) => file.endsWith('.map'))).toEqual([])
    expect(filesBelow(join(root, '.output', WITHHELD_SOURCE_MAP_DIRECTORY))).toEqual([])
  })

  it('reproduces the served-map defect without the plugin', async () => {
    const root = projectRoot()
    const uploaded: string[] = []
    const listed: string[] = []

    await buildLikeNitro(root, [
      uploader(uploaded, false),
      publicAssetManifest(join(root, '.output/public'), listed),
    ])

    // Nitro would serve these ids, and answer 500 once the Dockerfile deletes them.
    expect(uploaded).toHaveLength(2)
    expect(listed.filter((file) => file.endsWith('.map'))).toEqual(uploaded)
  })
})
