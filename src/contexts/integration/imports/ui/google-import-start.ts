import type { StartPropertyImportItemInput } from '#/contexts/integration/application/public-api'
import type { GoogleImportFns } from './google-import-manager-contract'

type StartResult = Readonly<{ importJobId: string; requestId: string }>

export type GoogleImportStartDeps = Readonly<{
  /** The idempotency handle, minted before the call and reused by a retry. */
  requestId: string
  items: readonly StartPropertyImportItemInput[]
  start: (
    input: Parameters<GoogleImportFns['startPropertyImportV2']>[0],
  ) => Promise<StartResult>
  /** Resolves the committed import for this request id, or null when none exists. */
  recover: (requestId: string) => Promise<string | null>
  /** False once the manager left the page or its discovery view was cleared. */
  isCurrent: () => boolean
  /** Names the committed request in the URL, so a reload recovers the import. */
  navigateToRequest: (requestId: string) => Promise<void>
  openProgress: (importJobId: string) => Promise<void>
}>

export type GoogleImportStartOutcome =
  | Readonly<{ kind: 'started' | 'recovered'; importJobId: string }>
  | Readonly<{ kind: 'failed'; error: unknown }>
  | Readonly<{ kind: 'abandoned' }>

/**
 * Starts a confirmed import and only then points the URL at it. The URL used
 * to name the request before the call went out, so a reload during the call
 * landed on a request id the server had never committed.
 *
 * A failed call is not proof that nothing committed: the request id is looked
 * up before the failure is reported, and a committed import opens as usual.
 */
export async function startGoogleImport(
  deps: GoogleImportStartDeps,
): Promise<GoogleImportStartOutcome> {
  let importJobId: string | null
  let failure: Readonly<{ error: unknown }> | null = null
  try {
    const result = await deps.start({
      data: { requestId: deps.requestId, items: [...deps.items], confirmation: 'apply' },
    })
    if (result.requestId !== deps.requestId) throw new Error('import_request_mismatch')
    importJobId = result.importJobId
  } catch (error) {
    failure = { error }
    importJobId = await deps.recover(deps.requestId)
  }

  if (!deps.isCurrent()) return { kind: 'abandoned' }
  if (importJobId === null) return { kind: 'failed', error: failure?.error }

  await deps.navigateToRequest(deps.requestId)
  await deps.openProgress(importJobId)
  return { kind: failure === null ? 'started' : 'recovered', importJobId }
}
