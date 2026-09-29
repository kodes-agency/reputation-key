import { mkdir, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Plugin, Rolldown } from 'vite'

/** The environment Nitro's Vite plugin builds last; it bundles the static-asset manifest. */
export const NITRO_ENVIRONMENT = 'nitro'

/** Sibling of the served public directory, so withheld maps are never listed or served. */
export const WITHHELD_SOURCE_MAP_DIRECTORY = 'client-source-maps'

interface ClientOutput {
  readonly outDir: string
  readonly maps: readonly string[]
}

/** Every source map a client bundle wrote, relative to its output directory. */
function emittedSourceMaps(bundle: Rolldown.OutputBundle): readonly string[] {
  const maps = Object.values(bundle).flatMap((file) => {
    if (file.type === 'chunk')
      return file.sourcemapFileName ? [file.sourcemapFileName] : []
    return file.fileName.endsWith('.map') ? [file.fileName] : []
  })
  return [...new Set(maps)]
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function withhold({ outDir, maps }: ClientOutput): Promise<void> {
  const target = join(dirname(outDir), WITHHELD_SOURCE_MAP_DIRECTORY)
  await Promise.all(
    maps.map(async (map) => {
      const destination = join(target, map)
      await mkdir(dirname(destination), { recursive: true })
      try {
        await rename(join(outDir, map), destination)
      } catch (error) {
        // Sentry's `filesToDeleteAfterUpload` already removed it: nothing to withhold.
        if (!isMissingFile(error)) throw error
      }
    }),
  )
}

/**
 * Keep client source maps out of the files Nitro serves.
 *
 * The client environment writes hidden maps into Nitro's public directory
 * (`.output/public`). When the Nitro environment builds, it snapshots every
 * file there into its static-asset manifest. The Dockerfile deletes the maps
 * afterwards, so Nitro kept serving ids it could no longer read: each
 * `GET /assets/<chunk>.js.map` answered 500 and paged the owner through Sentry.
 *
 * The maps have one consumer, Sentry's upload, which runs and is awaited in the
 * client environment's `writeBundle`. They are moved when the Nitro environment
 * starts building: after every client-environment hook, upload included, has
 * finished, and before the manifest module is loaded. That order comes from
 * Nitro itself, which must build the client before it can list its output, so
 * it does not depend on how the bundler schedules hooks inside one build.
 *
 * Maps move to a sibling directory rather than being deleted so a local build
 * can still inspect them; the Dockerfile deletes `.output/**\/*.map` before the
 * image is assembled.
 */
export function withholdClientSourceMaps(): Plugin {
  let clientOutputs: readonly ClientOutput[] = []
  return {
    name: 'repkey-withhold-client-source-maps',
    apply: 'build',
    // One instance must see both the client and the Nitro environment.
    sharedDuringBuild: true,
    writeBundle(outputOptions, bundle) {
      if (this.environment.config.consumer !== 'client' || !outputOptions.dir) return
      clientOutputs = [
        ...clientOutputs,
        { outDir: resolve(outputOptions.dir), maps: emittedSourceMaps(bundle) },
      ]
    },
    async buildStart() {
      if (this.environment.name !== NITRO_ENVIRONMENT) return
      const pending = clientOutputs
      clientOutputs = []
      for (const output of pending) await withhold(output)
    },
  }
}
