import { sentryTanstackStart } from '@sentry/tanstackstart-react/vite'
import type { Plugin, PluginOption } from 'vite'

export type SentryUploadEnvironment = Readonly<{
  SENTRY_AUTH_TOKEN?: string
  SENTRY_ORG?: string
  SENTRY_PROJECT?: string
  SOURCE_REVISION?: string
}>

/** Where the client build writes its chunks, and the URL path they are served at. */
export const CLIENT_ASSET_DIRECTORY = './.output/public/assets'
export const CLIENT_ASSET_URL_PREFIX = '~/assets'

type Consumer = 'client' | 'server'
type ReleaseOptions = NonNullable<
  NonNullable<Parameters<typeof sentryTanstackStart>[0]>['release']
>
type LegacyUpload = Readonly<{
  uploadLegacySourcemaps: Readonly<{ paths: string[]; urlPrefix: string }>
}>

function flatPlugins(options: PluginOption): Plugin[] {
  if (Array.isArray(options)) return options.flatMap(flatPlugins)
  return options && typeof options === 'object' && 'name' in options ? [options] : []
}

/** The same plugins, active only in the environments of one consumer. */
export function onlyFor(consumer: Consumer, options: PluginOption): Plugin[] {
  return flatPlugins(options).map((plugin) => ({
    ...plugin,
    applyToEnvironment: (environment) =>
      environment.config.consumer === consumer &&
      (plugin.applyToEnvironment?.(environment) ?? true) !== false,
  }))
}

/**
 * Source maps for Sentry, uploaded from the image build (the only build with
 * the token), in two ways:
 *
 * - Server bundles get debug ids: a snippet in each file ties its frames to
 *   its map whatever release a process reports.
 * - Browser chunks are uploaded against the release instead, and get no
 *   snippet. A debug id is ~220 B gzip in every chunk, which put first paint
 *   +16.8 KB over its budget (307,476 -> 324,298 B, measured 2026-10-16), and
 *   the budget gate builds without the token so it would never have seen it.
 *   The browser reports the deployed commit as its release (the
 *   `repkey-sentry-release` meta tag), the same SHA CI builds as
 *   SOURCE_REVISION, so Sentry finds each chunk's map by its URL.
 *
 * The maps never ship: withholdClientSourceMaps keeps the client's out of the
 * served files, and the Dockerfile deletes every map after its checks.
 */
export function sentrySourceMapUpload(env: SentryUploadEnvironment): Plugin[] {
  const shared = {
    org: env.SENTRY_ORG,
    project: env.SENTRY_PROJECT,
    authToken: env.SENTRY_AUTH_TOKEN,
    telemetry: false,
  }
  // The image build has no `.git` (.dockerignore), so associating commits
  // would fail and skip finalizing the release; the maps do not need it.
  const server = sentryTanstackStart({
    ...shared,
    release: { name: env.SOURCE_REVISION, setCommits: false },
    sourcemaps: { filesToDeleteAfterUpload: ['./.output/**/*.map'] },
  })
  // The wrapper hands `release` to the Vite plugin as it is; its type has not
  // caught up with the plugin's `uploadLegacySourcemaps` option.
  const clientRelease: ReleaseOptions & LegacyUpload = {
    name: env.SOURCE_REVISION,
    setCommits: false,
    inject: false,
    uploadLegacySourcemaps: {
      paths: [CLIENT_ASSET_DIRECTORY],
      urlPrefix: CLIENT_ASSET_URL_PREFIX,
    },
  }
  const client = sentryTanstackStart({
    ...shared,
    release: clientRelease,
    sourcemaps: { disable: true },
    autoInstrumentMiddleware: false,
  })
  return [...onlyFor('server', server), ...onlyFor('client', client)]
}
